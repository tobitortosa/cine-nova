import {
  Component,
  ElementRef,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { SoloDigitosDirective } from '../directives/solo-digitos.directive';
import { dosDigitos, esHoraValida } from '../utils/fechas';

type Parte = 'hora' | 'minutos';

interface EstadoHora {
  tipo: 'vacia' | 'incompleta' | 'invalida' | 'valida';
  texto: string;
  error: string;
}

interface OpcionHorario {
  texto: string;
  deshabilitado: boolean;
}

const SEPARADORES: readonly string[] = [':', '.', ' ', ',', 'h', 'H'];

@Component({
  selector: 'app-campo-hora',
  imports: [SoloDigitosDirective],
  templateUrl: './campo-hora.component.html',
  styleUrl: './campo-hora.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CampoHoraComponent),
      multi: true,
    },
  ],
  host: {
    '[attr.id]': 'null',
  },
})
export class CampoHoraComponent implements ControlValueAccessor {
  private static contador = 0;

  private readonly anfitrion = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly valor = model<string>('');
  readonly minimo = input<string>('');
  readonly sugeridos = input<readonly string[]>([]);
  readonly id = input<string>('');
  readonly etiqueta = input<string>('Hora');

  readonly prefijo = `campo-hora-${++CampoHoraComponent.contador}`;

  readonly hora = signal('');
  readonly minutos = signal('');
  readonly deshabilitado = signal(false);
  readonly enfocado = signal(false);

  private readonly campoHora = viewChild<ElementRef<HTMLInputElement>>('campoHora');
  private readonly campoMinutos = viewChild<ElementRef<HTMLInputElement>>('campoMinutos');

  private ultimoEmitido = '';
  private alCambiar: (valor: string) => void = () => undefined;
  private alTocar: () => void = () => undefined;

  readonly horaMinima = computed(() => (esHoraValida(this.minimo()) ? this.minimo() : ''));

  readonly estado = computed<EstadoHora>(() => {
    const hora = this.hora();
    const minutos = this.minutos();

    if (!hora && !minutos) return { tipo: 'vacia', texto: '', error: '' };

    if (hora.length === 2 && Number(hora) > 23) return this.invalida('La hora va de 00 a 23.');
    if (minutos.length === 2 && Number(minutos) > 59) {
      return this.invalida('Los minutos van de 00 a 59.');
    }
    if (!hora || minutos.length < 2) {
      return { tipo: 'incompleta', texto: '', error: 'Completá la hora y los minutos (HH:MM).' };
    }

    const texto = `${hora.padStart(2, '0')}:${minutos}`;
    const minima = this.horaMinima();
    if (minima && texto < minima) {
      return { tipo: 'invalida', texto, error: `Tiene que ser desde las ${minima} h.` };
    }

    return { tipo: 'valida', texto, error: '' };
  });

  readonly mostrarError = computed(() => {
    const tipo = this.estado().tipo;
    return tipo === 'invalida' || (tipo === 'incompleta' && !this.enfocado());
  });

  readonly opcionesSugeridas = computed<OpcionHorario[]>(() => {
    const minima = this.horaMinima();
    return this.sugeridos()
      .filter((texto) => esHoraValida(texto))
      .map((texto) => ({ texto, deshabilitado: minima !== '' && texto < minima }));
  });

  constructor() {
    effect(() => {
      const entrante = this.valor();
      untracked(() => {
        if (entrante !== this.ultimoEmitido) this.leer(this.normalizar(entrante));
      });
    });
  }

  writeValue(valor: unknown): void {
    const texto = this.normalizar(valor);
    this.leer(texto);
    this.valor.set(texto);
  }

  registerOnChange(funcion: (valor: string) => void): void {
    this.alCambiar = funcion;
  }

  registerOnTouched(funcion: () => void): void {
    this.alTocar = funcion;
  }

  setDisabledState(deshabilitado: boolean): void {
    this.deshabilitado.set(deshabilitado);
  }

  enfocar(): void {
    this.enfocarParte('hora', 'todo');
  }

  alEscribir(parte: Parte, evento: Event): void {
    const texto = (evento.target as HTMLInputElement).value.replace(/\D/g, '');
    const borrando = evento instanceof InputEvent && evento.inputType.startsWith('delete');
    this.fijar(parte, texto);

    if (!borrando && texto.length === 1 && Number(texto) > (parte === 'hora' ? 2 : 5)) {
      this.fijar(parte, texto.padStart(2, '0'));
      if (parte === 'hora') this.enfocarParte('minutos', 'todo');
    } else if (!borrando && parte === 'hora' && texto.length === 2) {
      this.enfocarParte('minutos', 'todo');
    }

    this.emitir();
  }

  alTeclear(parte: Parte, evento: KeyboardEvent): void {
    const campo = evento.target as HTMLInputElement;

    if (SEPARADORES.includes(evento.key)) {
      evento.preventDefault();
      if (parte === 'hora' && campo.value) {
        this.fijar('hora', campo.value.padStart(2, '0'));
        this.emitir();
        this.enfocarParte('minutos', 'todo');
      }
      return;
    }

    const alPrincipio = campo.selectionStart === 0 && campo.selectionEnd === 0;
    const alFinal =
      campo.selectionStart === campo.value.length && campo.selectionEnd === campo.value.length;

    switch (evento.key) {
      case 'Backspace':
        if (parte === 'minutos' && campo.value === '') {
          evento.preventDefault();
          this.enfocarParte('hora', 'final');
        }
        return;
      case 'ArrowLeft':
        if (parte === 'minutos' && alPrincipio) {
          evento.preventDefault();
          this.enfocarParte('hora', 'final');
        }
        return;
      case 'ArrowRight':
        if (parte === 'hora' && alFinal) {
          evento.preventDefault();
          this.enfocarParte('minutos', 'inicio');
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
    this.fijar('hora', partes.hora);
    this.fijar('minutos', partes.minutos);
    this.emitir();
    this.enfocarParte('minutos', 'final');
  }

  alSalirDeParte(parte: Parte): void {
    const texto = parte === 'hora' ? this.hora() : this.minutos();
    if (texto.length !== 1) return;
    this.fijar(parte, texto.padStart(2, '0'));
    this.emitir();
  }

  alEntrar(): void {
    this.enfocado.set(true);
  }

  alSalirDelGrupo(evento: FocusEvent): void {
    const destino = evento.relatedTarget as Node | null;
    if (destino && this.anfitrion.nativeElement.contains(destino)) return;

    if (this.hora() && !this.minutos()) {
      this.fijar('minutos', '00');
      this.emitir();
    }

    this.enfocado.set(false);
    this.alTocar();
  }

  alClickearCaja(evento: MouseEvent): void {
    if (this.deshabilitado()) return;
    if ((evento.target as HTMLElement).closest('input, button')) return;
    this.enfocarParte(this.hora() ? 'minutos' : 'hora', 'final');
  }

  seleccionar(evento: MouseEvent): void {
    const campo = evento.target as HTMLInputElement;
    if (campo.selectionStart === campo.selectionEnd) campo.select();
  }

  elegirSugerido(texto: string): void {
    this.fijar('hora', texto.slice(0, 2));
    this.fijar('minutos', texto.slice(3, 5));
    this.emitir();
  }

  private emitir(): void {
    const texto = this.estado().texto;
    if (texto === this.ultimoEmitido) return;
    this.ultimoEmitido = texto;
    this.valor.set(texto);
    this.alCambiar(texto);
  }

  private leer(texto: string): void {
    this.ultimoEmitido = texto;
    this.fijar('hora', texto.slice(0, 2));
    this.fijar('minutos', texto.slice(3, 5));
  }

  private normalizar(valor: unknown): string {
    if (typeof valor !== 'string') return '';
    const texto = valor.trim().slice(0, 5);
    return esHoraValida(texto) ? texto : '';
  }

  private mover(parte: Parte, paso: number): void {
    const actual = parte === 'hora' ? this.hora() : this.minutos();
    const tope = parte === 'hora' ? 24 : 60;
    const base = actual === '' ? (parte === 'hora' ? new Date().getHours() : 0) : Number(actual) + paso;
    this.fijar(parte, dosDigitos(((base % tope) + tope) % tope));
    this.emitir();
  }

  private interpretar(texto: string): { hora: string; minutos: string } | null {
    const limpio = texto.trim().toLowerCase().replace(/\s*h(s|rs)?\.?$/, '');

    const separada = /^(\d{1,2})\s*[:.h ]\s*(\d{2})$/.exec(limpio);
    if (separada) return { hora: separada[1].padStart(2, '0'), minutos: separada[2] };

    const junta = /^(\d{1,2})(\d{2})$/.exec(limpio);
    if (junta) return { hora: junta[1].padStart(2, '0'), minutos: junta[2] };

    return null;
  }

  private invalida(error: string): EstadoHora {
    return { tipo: 'invalida', texto: '', error };
  }

  private fijar(parte: Parte, texto: string): void {
    (parte === 'hora' ? this.hora : this.minutos).set(texto);
    const campo = this.elemento(parte);
    if (campo && campo.value !== texto) campo.value = texto;
  }

  private enfocarParte(parte: Parte, seleccion: 'todo' | 'inicio' | 'final'): void {
    const campo = this.elemento(parte);
    if (!campo) return;
    campo.focus();
    const largo = campo.value.length;
    if (seleccion === 'todo') campo.setSelectionRange(0, largo);
    else if (seleccion === 'inicio') campo.setSelectionRange(0, 0);
    else campo.setSelectionRange(largo, largo);
  }

  private elemento(parte: Parte): HTMLInputElement | undefined {
    return (parte === 'hora' ? this.campoHora() : this.campoMinutos())?.nativeElement;
  }
}
