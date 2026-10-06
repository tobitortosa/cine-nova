import {
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  ControlValueAccessor,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { SoloDigitosDirective } from '../directives/solo-digitos.directive';
import {
  MESES,
  armarClave,
  capitalizar,
  describirFecha,
  diasDelMes,
  dosDigitos,
  fechaCorta,
  normalizarClave,
} from '../utils/fechas';
import { hoyLocal, sumarDias } from '../utils/ventas';

export type ModoCampoFecha = 'general' | 'nacimiento';

export interface AtajoFecha {
  texto: string;
  dias: number;
}

type Parte = 'dia' | 'mes' | 'anio';

interface EstadoFecha {
  tipo: 'vacia' | 'incompleta' | 'invalida' | 'valida';
  clave: string;
  error: string;
}

interface OpcionAtajo {
  texto: string;
  clave: string;
  descripcion: string;
  deshabilitado: boolean;
}

const PARTES: readonly Parte[] = ['dia', 'mes', 'anio'];
const SEPARADORES: readonly string[] = ['/', '-', '.', ' ', ','];
const ANIOS_HACIA_ATRAS = 120;

@Component({
  selector: 'app-campo-fecha',
  imports: [SoloDigitosDirective],
  templateUrl: './campo-fecha.component.html',
  styleUrl: './campo-fecha.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CampoFechaComponent),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => CampoFechaComponent),
      multi: true,
    },
  ],
  host: {
    '[attr.id]': 'null',
  },
})
export class CampoFechaComponent implements ControlValueAccessor, Validator {
  private static contador = 0;

  private readonly anfitrion = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly valor = model<string>('');
  readonly minimo = input<string>('');
  readonly maximo = input<string>('');
  readonly modo = input<ModoCampoFecha>('general');
  readonly id = input<string>('');
  readonly etiqueta = input<string>('Fecha');
  readonly ayuda = input<string>('');
  readonly atajos = input<readonly AtajoFecha[]>([]);
  readonly borrable = input(false, { transform: booleanAttribute });
  readonly completa = output<string>();

  readonly prefijo = `campo-fecha-${++CampoFechaComponent.contador}`;

  readonly dia = signal('');
  readonly mes = signal('');
  readonly anio = signal('');
  readonly deshabilitado = signal(false);
  readonly enfocado = signal(false);

  private readonly campoDia = viewChild<ElementRef<HTMLInputElement>>('campoDia');
  private readonly campoMes = viewChild<ElementRef<HTMLInputElement>>('campoMes');
  private readonly campoAnio = viewChild<ElementRef<HTMLInputElement>>('campoAnio');

  private ultimoEmitido = '';
  private ultimoError = '';
  private alCambiar: (valor: string) => void = () => undefined;
  private alTocar: () => void = () => undefined;
  private alCambiarValidez: () => void = () => undefined;

  readonly claveMinima = computed(() => {
    const minima = normalizarClave(this.minimo());
    if (minima || this.modo() !== 'nacimiento') return minima;
    const hoy = hoyLocal();
    return `${Number(hoy.slice(0, 4)) - ANIOS_HACIA_ATRAS}${hoy.slice(4)}`;
  });

  readonly claveMaxima = computed(() => {
    const maxima = normalizarClave(this.maximo());
    if (maxima || this.modo() !== 'nacimiento') return maxima;
    return hoyLocal();
  });

  readonly estado = computed<EstadoFecha>(() => {
    const dia = this.dia();
    const mes = this.mes();
    const anio = this.anio();

    if (!dia && !mes && !anio) return { tipo: 'vacia', clave: '', error: '' };

    const numeroDia = Number(dia);
    const numeroMes = Number(mes);
    const numeroAnio = Number(anio);

    if (dia.length === 2 && (numeroDia < 1 || numeroDia > 31)) {
      return this.invalida('El día va del 01 al 31.');
    }
    if (mes.length === 2 && (numeroMes < 1 || numeroMes > 12)) {
      return this.invalida('El mes va del 01 al 12.');
    }
    if (!numeroDia || !numeroMes || anio.length < 4) {
      return { tipo: 'incompleta', clave: '', error: 'Completá día, mes y año (DD/MM/AAAA).' };
    }
    if (numeroAnio < 1) return this.invalida('Revisá el año.');

    const tope = diasDelMes(numeroAnio, numeroMes);
    if (numeroDia > tope) {
      return this.invalida(
        `Esa fecha no existe: ${MESES[numeroMes - 1]} de ${numeroAnio} tiene ${tope} días.`,
      );
    }

    const clave = armarClave(numeroAnio, numeroMes, numeroDia);
    const motivo = this.motivoFueraDeRango(clave);
    return motivo ? this.invalida(motivo) : { tipo: 'valida', clave, error: '' };
  });

  readonly hayTexto = computed(() => this.estado().tipo !== 'vacia');

  readonly mostrarError = computed(() => {
    const tipo = this.estado().tipo;
    return tipo === 'invalida' || (tipo === 'incompleta' && !this.enfocado());
  });

  readonly detalle = computed(() => {
    const estado = this.estado();
    if (this.mostrarError()) return estado.error;

    if (estado.tipo === 'valida') {
      const texto = capitalizar(describirFecha(estado.clave));
      if (this.modo() !== 'nacimiento') return texto;
      const edad = this.edad(estado.clave);
      return `${texto} · ${edad === 1 ? '1 año' : `${edad} años`}`;
    }

    if (this.ayuda()) return this.ayuda();
    if (this.modo() === 'nacimiento' && estado.tipo === 'vacia') {
      return 'Escribí día, mes y año. Por ejemplo: 15/07/1996.';
    }
    return '';
  });

  readonly opcionesAtajos = computed<OpcionAtajo[]>(() => {
    if (this.modo() === 'nacimiento') return [];
    const hoy = hoyLocal();
    return this.atajos().map((atajo) => {
      const clave = sumarDias(hoy, atajo.dias);
      return {
        texto: atajo.texto,
        clave,
        descripcion: capitalizar(describirFecha(clave)),
        deshabilitado: this.motivoFueraDeRango(clave) !== '',
      };
    });
  });

  constructor() {
    effect(() => {
      const entrante = this.valor();
      untracked(() => {
        if (entrante !== this.ultimoEmitido) this.leer(normalizarClave(entrante));
      });
    });
  }

  writeValue(valor: unknown): void {
    const clave = normalizarClave(valor);
    this.leer(clave);
    this.valor.set(clave);
  }

  registerOnChange(funcion: (valor: string) => void): void {
    this.alCambiar = funcion;
  }

  registerOnTouched(funcion: () => void): void {
    this.alTocar = funcion;
  }

  registerOnValidatorChange(funcion: () => void): void {
    this.alCambiarValidez = funcion;
  }

  setDisabledState(deshabilitado: boolean): void {
    this.deshabilitado.set(deshabilitado);
  }

  validate(): ValidationErrors | null {
    const error = this.errorDeValidacion();
    return error ? { fechaInvalida: error } : null;
  }

  alEscribir(parte: Parte, evento: Event): void {
    const texto = (evento.target as HTMLInputElement).value.replace(/\D/g, '');
    const borrando = evento instanceof InputEvent && evento.inputType.startsWith('delete');
    this.fijar(parte, texto);

    if (!borrando && parte !== 'anio' && this.parteLista(parte, texto)) {
      this.fijar(parte, texto.padStart(2, '0'));
      this.enfocar(this.siguiente(parte), 'todo');
    }

    this.emitir();

    const estado = this.estado();
    if (!borrando && parte === 'anio' && texto.length === 4 && estado.tipo === 'valida') {
      this.completa.emit(estado.clave);
    }
  }

  alTeclear(parte: Parte, evento: KeyboardEvent): void {
    const campo = evento.target as HTMLInputElement;

    if (SEPARADORES.includes(evento.key)) {
      evento.preventDefault();
      if (parte !== 'anio' && campo.value) {
        this.fijar(parte, campo.value.padStart(2, '0'));
        this.emitir();
        this.enfocar(this.siguiente(parte), 'todo');
      }
      return;
    }

    const alPrincipio = campo.selectionStart === 0 && campo.selectionEnd === 0;
    const alFinal =
      campo.selectionStart === campo.value.length && campo.selectionEnd === campo.value.length;

    switch (evento.key) {
      case 'Backspace':
        if (parte !== 'dia' && campo.value === '') {
          evento.preventDefault();
          this.enfocar(this.anterior(parte), 'final');
        }
        return;
      case 'ArrowLeft':
        if (parte !== 'dia' && alPrincipio) {
          evento.preventDefault();
          this.enfocar(this.anterior(parte), 'final');
        }
        return;
      case 'ArrowRight':
        if (parte !== 'anio' && alFinal) {
          evento.preventDefault();
          this.enfocar(this.siguiente(parte), 'inicio');
        }
        return;
      case 'ArrowUp':
      case 'ArrowDown':
        evento.preventDefault();
        this.mover(parte, evento.key === 'ArrowUp' ? 1 : -1);
        return;
    }
  }

  alPegar(evento: ClipboardEvent): void {
    const partes = this.interpretar(evento.clipboardData?.getData('text') ?? '');
    if (!partes) return;

    evento.preventDefault();
    this.fijar('dia', partes.dia);
    this.fijar('mes', partes.mes);
    this.fijar('anio', partes.anio);
    this.emitir();
    this.enfocar('anio', 'final');

    const estado = this.estado();
    if (estado.tipo === 'valida') this.completa.emit(estado.clave);
  }

  alSalirDeParte(parte: Parte): void {
    const texto = this.senial(parte)();

    if (parte !== 'anio' && texto.length === 1 && texto !== '0') {
      this.fijar(parte, texto.padStart(2, '0'));
      this.emitir();
      return;
    }

    if (parte === 'anio' && texto.length === 2) {
      this.fijar('anio', this.completarAnio(texto));
      this.emitir();
    }
  }

  alEntrar(): void {
    this.enfocado.set(true);
  }

  alSalirDelGrupo(evento: FocusEvent): void {
    const destino = evento.relatedTarget as Node | null;
    if (destino && this.anfitrion.nativeElement.contains(destino)) return;
    this.enfocado.set(false);
    this.alTocar();
  }

  alClickearCaja(evento: MouseEvent): void {
    if (this.deshabilitado()) return;
    if ((evento.target as HTMLElement).closest('input, button')) return;
    const vacia = PARTES.find((parte) => !this.senial(parte)());
    this.enfocar(vacia ?? 'anio', 'final');
  }

  seleccionar(evento: MouseEvent): void {
    const campo = evento.target as HTMLInputElement;
    if (campo.selectionStart === campo.selectionEnd) campo.select();
  }

  elegirAtajo(clave: string): void {
    this.llenar(clave);
    this.emitir();
    this.completa.emit(clave);
  }

  borrar(): void {
    this.llenar('');
    this.emitir();
    this.enfocar('dia', 'todo');
  }

  vaciar(): void {
    this.leer('');
  }

  private emitir(): void {
    const clave = this.estado().clave;
    const error = this.errorDeValidacion();

    if (clave !== this.ultimoEmitido) {
      this.ultimoEmitido = clave;
      this.valor.set(clave);
      this.alCambiar(clave);
    } else if (error !== this.ultimoError) {
      this.alCambiarValidez();
    }

    this.ultimoError = error;
  }

  private leer(clave: string): void {
    this.ultimoEmitido = clave;
    this.llenar(clave);
    this.ultimoError = this.errorDeValidacion();
  }

  private errorDeValidacion(): string {
    const estado = this.estado();
    return estado.tipo === 'incompleta' || estado.tipo === 'invalida' ? estado.error : '';
  }

  private llenar(clave: string): void {
    this.fijar('dia', clave.slice(8, 10));
    this.fijar('mes', clave.slice(5, 7));
    this.fijar('anio', clave.slice(0, 4));
  }

  private fijar(parte: Parte, texto: string): void {
    this.senial(parte).set(texto);
    const campo = this.elemento(parte);
    if (campo && campo.value !== texto) campo.value = texto;
  }

  private enfocar(parte: Parte, seleccion: 'todo' | 'inicio' | 'final'): void {
    const campo = this.elemento(parte);
    if (!campo) return;
    campo.focus();
    const largo = campo.value.length;
    if (seleccion === 'todo') campo.setSelectionRange(0, largo);
    else if (seleccion === 'inicio') campo.setSelectionRange(0, 0);
    else campo.setSelectionRange(largo, largo);
  }

  private mover(parte: Parte, paso: number): void {
    const hoy = hoyLocal();
    const actual = Number(this.senial(parte)());

    if (parte === 'anio') {
      const anio = actual ? actual + paso : Number(hoy.slice(0, 4));
      this.fijar('anio', String(Math.min(9999, Math.max(1, anio))).padStart(4, '0'));
      this.emitir();
      return;
    }

    const tope = parte === 'mes' ? 12 : this.topeDeDias();
    const deHoy = Number(parte === 'mes' ? hoy.slice(5, 7) : hoy.slice(8, 10));
    let siguiente = actual ? actual + paso : Math.min(deHoy, tope);
    if (siguiente > tope) siguiente = 1;
    if (siguiente < 1) siguiente = tope;
    this.fijar(parte, dosDigitos(siguiente));
    this.emitir();
  }

  private topeDeDias(): number {
    const mes = Number(this.mes());
    if (mes < 1 || mes > 12) return 31;
    const anio = this.anio().length === 4 ? Number(this.anio()) : 0;
    return diasDelMes(anio || 2000, mes);
  }

  private parteLista(parte: Parte, texto: string): boolean {
    if (texto.length >= 2) return true;
    if (texto.length === 0) return false;
    return Number(texto) > (parte === 'dia' ? 3 : 1);
  }

  private completarAnio(texto: string): string {
    const hoy = hoyLocal();
    const corto = Number(texto);
    const siglo = Number(hoy.slice(0, 2)) * 100;
    const pasaDeHoy = corto > Number(hoy.slice(2, 4));
    return String(this.modo() === 'nacimiento' && pasaDeHoy ? siglo - 100 + corto : siglo + corto);
  }

  private interpretar(texto: string): { dia: string; mes: string; anio: string } | null {
    const limpio = texto.trim();

    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(limpio);
    if (iso) return { dia: iso[3].padStart(2, '0'), mes: iso[2].padStart(2, '0'), anio: iso[1] };

    const separada = /^(\d{1,2})[\/.\- ](\d{1,2})[\/.\- ](\d{4})$/.exec(limpio);
    if (separada) {
      return {
        dia: separada[1].padStart(2, '0'),
        mes: separada[2].padStart(2, '0'),
        anio: separada[3],
      };
    }

    const junta = /^(\d{2})(\d{2})(\d{4})$/.exec(limpio);
    if (junta) return { dia: junta[1], mes: junta[2], anio: junta[3] };

    return null;
  }

  private motivoFueraDeRango(clave: string): string {
    const minima = this.claveMinima();
    const maxima = this.claveMaxima();
    const nacimiento = this.modo() === 'nacimiento';

    if (minima && clave < minima) {
      return nacimiento
        ? `Revisá el año: no puede ser anterior a ${minima.slice(0, 4)}.`
        : `Tiene que ser desde el ${fechaCorta(minima)}.`;
    }

    if (maxima && clave > maxima) {
      return nacimiento
        ? 'La fecha de nacimiento no puede ser futura.'
        : `Tiene que ser hasta el ${fechaCorta(maxima)}.`;
    }

    return '';
  }

  private edad(clave: string): number {
    const hoy = hoyLocal();
    const anios = Number(hoy.slice(0, 4)) - Number(clave.slice(0, 4));
    return hoy.slice(5) < clave.slice(5) ? anios - 1 : anios;
  }

  private invalida(error: string): EstadoFecha {
    return { tipo: 'invalida', clave: '', error };
  }

  private siguiente(parte: Parte): Parte {
    return PARTES[Math.min(PARTES.indexOf(parte) + 1, PARTES.length - 1)];
  }

  private anterior(parte: Parte): Parte {
    return PARTES[Math.max(PARTES.indexOf(parte) - 1, 0)];
  }

  private senial(parte: Parte) {
    if (parte === 'dia') return this.dia;
    return parte === 'mes' ? this.mes : this.anio;
  }

  private elemento(parte: Parte): HTMLInputElement | undefined {
    if (parte === 'dia') return this.campoDia()?.nativeElement;
    return parte === 'mes' ? this.campoMes()?.nativeElement : this.campoAnio()?.nativeElement;
  }
}
