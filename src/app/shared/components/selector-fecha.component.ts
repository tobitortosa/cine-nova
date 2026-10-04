import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { DIAS_CORTOS, DIAS_LARGOS, MESES } from '../utils/calendario';

export type ModoSelectorFecha = 'calendario' | 'nacimiento';

type VistaCalendario = 'dias' | 'meses' | 'anios';

interface CeldaDia {
  clave: string;
  dia: number;
  delMes: boolean;
  deshabilitado: boolean;
  hoy: boolean;
  descripcion: string;
}

interface OpcionMes {
  numero: number;
  nombre: string;
  deshabilitado: boolean;
  elegido: boolean;
}

interface OpcionAnio {
  anio: number;
  deshabilitado: boolean;
  elegido: boolean;
}

interface Ubicacion {
  arriba: number | null;
  abajo: number | null;
  izquierda: number;
  alturaMaxima: number | null;
}

@Component({
  selector: 'app-selector-fecha',
  imports: [],
  templateUrl: './selector-fecha.component.html',
  styleUrl: './selector-fecha.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SelectorFechaComponent),
      multi: true,
    },
  ],
  host: {
    '[attr.id]': 'null',
    '(document:click)': 'alClickearDocumento($event)',
    '(document:focusin)': 'alEnfocarDocumento($event)',
    '(window:resize)': 'reubicar()',
  },
})
export class SelectorFechaComponent implements ControlValueAccessor {
  private static contador = 0;

  private readonly anfitrion = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly valor = model<string>('');
  readonly minimo = input<string>('');
  readonly maximo = input<string>('');
  readonly modo = input<ModoSelectorFecha>('calendario');
  readonly id = input<string>('');
  readonly etiqueta = input<string>('Fecha');
  readonly textoVacio = input<string>('Elegí una fecha');

  readonly prefijo = `selector-fecha-${++SelectorFechaComponent.contador}`;

  readonly meses = MESES;
  readonly diasCortos = DIAS_CORTOS;
  private readonly diasLargos = DIAS_LARGOS;

  readonly deshabilitado = signal(false);
  readonly abierto = signal(false);
  readonly enHoja = signal(false);
  readonly vista = signal<VistaCalendario>('dias');
  readonly anioVisible = signal(new Date().getFullYear());
  readonly mesVisible = signal(new Date().getMonth());
  readonly paginaAnios = signal(new Date().getFullYear() - 5);
  readonly claveEnfoque = signal('');
  readonly ubicacion = signal<Ubicacion>({ arriba: null, abajo: null, izquierda: 0, alturaMaxima: null });

  readonly diaParcial = signal<number | null>(null);
  readonly mesParcial = signal<number | null>(null);
  readonly anioParcial = signal<number | null>(null);

  private readonly disparador = viewChild<ElementRef<HTMLButtonElement>>('disparador');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  private alCambiar: (valor: string) => void = () => undefined;
  private alTocar: () => void = () => undefined;
  private readonly alDesplazar = (): void => this.reubicar();

  readonly valorActual = computed(() => this.normalizar(this.valor()));

  readonly claveMinima = computed(() => this.normalizar(this.minimo()));

  readonly claveMaxima = computed(() => {
    const maxima = this.normalizar(this.maximo());
    if (maxima || this.modo() !== 'nacimiento') return maxima;
    return this.claveDe(new Date());
  });

  private readonly anioPiso = computed(() => {
    const minima = this.claveMinima();
    if (minima) return Number(minima.slice(0, 4));
    return this.modo() === 'nacimiento' ? new Date().getFullYear() - 120 : 1900;
  });

  private readonly anioTope = computed(() => {
    const maxima = this.claveMaxima();
    return maxima ? Number(maxima.slice(0, 4)) : 2100;
  });

  readonly textoVisible = computed(() => {
    const clave = this.valorActual();
    if (!clave) return this.textoVacio();
    return `${clave.slice(8, 10)}/${clave.slice(5, 7)}/${clave.slice(0, 4)}`;
  });

  readonly descripcionValor = computed(() => {
    const clave = this.valorActual();
    return clave ? this.capitalizar(this.describir(clave)) : '';
  });

  readonly hoyDisponible = computed(() => !this.fueraDeRango(this.claveDe(new Date())));

  readonly celdas = computed<CeldaDia[]>(() => {
    const anio = this.anioVisible();
    const mes = this.mesVisible();
    const corrimiento = (new Date(anio, mes, 1).getDay() + 6) % 7;
    const totalDias = this.diasDelMes(anio, mes + 1);
    const cantidad = Math.ceil((corrimiento + totalDias) / 7) * 7;
    const hoy = this.claveDe(new Date());
    const lista: CeldaDia[] = [];

    for (let i = 0; i < cantidad; i++) {
      const fecha = new Date(anio, mes, 1 - corrimiento + i);
      const clave = this.claveDe(fecha);
      lista.push({
        clave,
        dia: fecha.getDate(),
        delMes: fecha.getMonth() === mes,
        deshabilitado: this.fueraDeRango(clave),
        hoy: clave === hoy,
        descripcion: this.capitalizar(this.describir(clave)),
      });
    }

    return lista;
  });

  readonly claveTabulable = computed(() => {
    const habilitadas = this.celdas().filter((celda) => celda.delMes && !celda.deshabilitado);
    const candidatas = [this.claveEnfoque(), this.valorActual(), this.claveDe(new Date())];
    const elegida = candidatas.find((clave) => habilitadas.some((celda) => celda.clave === clave));
    return elegida ?? habilitadas[0]?.clave ?? '';
  });

  readonly opcionesMeses = computed<OpcionMes[]>(() => {
    const anio = this.anioVisible();
    const elegida = this.valorActual();
    return this.meses.map((nombre, indice) => ({
      numero: indice,
      nombre: this.capitalizar(nombre),
      deshabilitado: this.mesFueraDeRango(anio, indice + 1),
      elegido: elegida.slice(0, 7) === `${anio}-${this.dosDigitos(indice + 1)}`,
    }));
  });

  readonly opcionesAnios = computed<OpcionAnio[]>(() => {
    const inicio = this.paginaAnios();
    const elegida = this.valorActual();
    return Array.from({ length: 12 }, (_, indice) => {
      const anio = inicio + indice;
      return {
        anio,
        deshabilitado: anio < this.anioPiso() || anio > this.anioTope(),
        elegido: elegida.slice(0, 4) === `${anio}`,
      };
    });
  });

  readonly puedeRetroceder = computed(() => {
    switch (this.vista()) {
      case 'meses':
        return this.anioVisible() > this.anioPiso();
      case 'anios':
        return this.paginaAnios() > this.anioPiso();
      default: {
        const actual = `${this.anioVisible()}-${this.dosDigitos(this.mesVisible() + 1)}`;
        const minima = this.claveMinima();
        return actual > (minima ? minima.slice(0, 7) : `${this.anioPiso()}-01`);
      }
    }
  });

  readonly puedeAvanzar = computed(() => {
    switch (this.vista()) {
      case 'meses':
        return this.anioVisible() < this.anioTope();
      case 'anios':
        return this.paginaAnios() + 11 < this.anioTope();
      default: {
        const actual = `${this.anioVisible()}-${this.dosDigitos(this.mesVisible() + 1)}`;
        const maxima = this.claveMaxima();
        return actual < (maxima ? maxima.slice(0, 7) : `${this.anioTope()}-12`);
      }
    }
  });

  readonly textoAnterior = computed(() => {
    switch (this.vista()) {
      case 'meses':
        return 'Año anterior';
      case 'anios':
        return 'Años anteriores';
      default:
        return 'Mes anterior';
    }
  });

  readonly textoSiguiente = computed(() => {
    switch (this.vista()) {
      case 'meses':
        return 'Año siguiente';
      case 'anios':
        return 'Años siguientes';
      default:
        return 'Mes siguiente';
    }
  });

  readonly diasNacimiento = computed(() => {
    const total = this.diasDelMes(this.anioParcial() ?? 2000, this.mesParcial() ?? 1);
    return Array.from({ length: total }, (_, indice) => indice + 1);
  });

  readonly mesesNacimiento = computed<OpcionMes[]>(() => {
    const anio = this.anioParcial();
    const mes = this.mesParcial();
    return this.meses.map((nombre, indice) => ({
      numero: indice + 1,
      nombre: this.capitalizar(nombre),
      deshabilitado: anio !== null && this.mesFueraDeRango(anio, indice + 1),
      elegido: mes === indice + 1,
    }));
  });

  readonly aniosNacimiento = computed(() => {
    const elegido = this.anioParcial();
    const tope = Math.max(this.anioTope(), elegido ?? this.anioTope());
    const piso = Math.min(this.anioPiso(), elegido ?? this.anioPiso());
    return Array.from({ length: Math.max(0, tope - piso + 1) }, (_, indice) => tope - indice);
  });

  constructor() {
    effect(() => this.leer(this.valorActual()));
    inject(DestroyRef).onDestroy(() => this.escucharDesplazamiento(false));
  }

  writeValue(valor: unknown): void {
    const limpio = this.normalizar(valor);
    this.valor.set(limpio);
    this.leer(limpio);
  }

  registerOnChange(funcion: (valor: string) => void): void {
    this.alCambiar = funcion;
  }

  registerOnTouched(funcion: () => void): void {
    this.alTocar = funcion;
  }

  setDisabledState(deshabilitado: boolean): void {
    this.deshabilitado.set(deshabilitado);
    if (deshabilitado) this.cerrar(false);
  }

  dosDigitos(valor: number): string {
    return String(valor).padStart(2, '0');
  }

  diaNacimientoDeshabilitado(dia: number): boolean {
    const anio = this.anioParcial();
    const mes = this.mesParcial();
    if (anio === null || mes === null) return false;
    return this.fueraDeRango(this.armarClave(anio, mes, dia));
  }

  elegirDiaParcial(texto: string): void {
    this.diaParcial.set(this.numeroDe(texto));
    this.completarNacimiento();
  }

  elegirMesParcial(texto: string): void {
    this.mesParcial.set(this.numeroDe(texto));
    this.completarNacimiento();
  }

  elegirAnioParcial(texto: string): void {
    this.anioParcial.set(this.numeroDe(texto));
    this.completarNacimiento();
  }

  alSalirDelGrupo(evento: FocusEvent): void {
    const grupo = evento.currentTarget as HTMLElement | null;
    const destino = evento.relatedTarget as Node | null;
    if (grupo && destino && grupo.contains(destino)) return;
    this.alTocar();
  }

  alternar(): void {
    if (this.deshabilitado()) return;
    if (this.abierto()) {
      this.cerrar(true);
      return;
    }
    this.abrir();
  }

  alTeclearDisparador(evento: KeyboardEvent): void {
    if (evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp') return;
    if (this.abierto() || this.deshabilitado()) return;
    evento.preventDefault();
    this.abrir();
  }

  alPresionarEscape(evento: Event): void {
    if (!this.abierto()) return;
    evento.preventDefault();
    evento.stopPropagation();
    this.cerrar(true);
  }

  alClickearDocumento(evento: MouseEvent): void {
    if (!this.abierto()) return;
    const destino = evento.target as Node | null;
    const propio = this.anfitrion.nativeElement;
    if (destino && propio.contains(destino)) return;
    const rotulo = destino instanceof Element ? destino.closest('label') : null;
    if (rotulo?.control && propio.contains(rotulo.control)) return;
    this.cerrar(false);
  }

  alEnfocarDocumento(evento: FocusEvent): void {
    if (!this.abierto()) return;
    const destino = evento.target as Node | null;
    if (destino && this.anfitrion.nativeElement.contains(destino)) return;
    this.cerrar(false);
  }

  cerrar(devolverFoco: boolean): void {
    if (!this.abierto()) return;
    this.abierto.set(false);
    this.escucharDesplazamiento(false);
    this.alTocar();
    if (devolverFoco) this.disparador()?.nativeElement.focus();
  }

  anterior(): void {
    if (!this.puedeRetroceder()) return;
    switch (this.vista()) {
      case 'meses':
        this.anioVisible.update((anio) => anio - 1);
        return;
      case 'anios':
        this.paginaAnios.update((inicio) => inicio - 12);
        return;
      default:
        this.moverMes(-1);
    }
  }

  siguiente(): void {
    if (!this.puedeAvanzar()) return;
    switch (this.vista()) {
      case 'meses':
        this.anioVisible.update((anio) => anio + 1);
        return;
      case 'anios':
        this.paginaAnios.update((inicio) => inicio + 12);
        return;
      default:
        this.moverMes(1);
    }
  }

  verMeses(): void {
    this.vista.set('meses');
    this.enfocarActual();
  }

  verAnios(): void {
    const piso = this.anioPiso();
    const tope = this.anioTope();
    const centrado = Math.min(this.anioVisible() - 5, tope - 11);
    this.paginaAnios.set(Math.max(piso, centrado));
    this.vista.set('anios');
    this.enfocarActual();
  }

  volverADias(): void {
    this.vista.set('dias');
    this.enfocarActual();
  }

  elegirAnio(opcion: OpcionAnio): void {
    if (opcion.deshabilitado) return;
    const prefijo = `${opcion.anio}-${this.dosDigitos(this.mesVisible() + 1)}`;
    const minima = this.claveMinima();
    const maxima = this.claveMaxima();
    if (minima && prefijo < minima.slice(0, 7)) this.mesVisible.set(Number(minima.slice(5, 7)) - 1);
    if (maxima && prefijo > maxima.slice(0, 7)) this.mesVisible.set(Number(maxima.slice(5, 7)) - 1);
    this.anioVisible.set(opcion.anio);
    this.vista.set('meses');
    this.enfocarActual();
  }

  elegirMes(opcion: OpcionMes): void {
    if (opcion.deshabilitado) return;
    const anio = this.anioVisible();
    const diaBase = Number(this.claveEnfoque().slice(8, 10)) || 1;
    const dia = Math.min(diaBase, this.diasDelMes(anio, opcion.numero + 1));
    this.mesVisible.set(opcion.numero);
    this.claveEnfoque.set(this.acotar(this.armarClave(anio, opcion.numero + 1, dia)));
    this.vista.set('dias');
    this.enfocarActual();
  }

  elegirDia(celda: CeldaDia): void {
    if (celda.deshabilitado) return;
    this.aplicar(celda.clave);
    this.cerrar(true);
  }

  elegirHoy(): void {
    const hoy = this.claveDe(new Date());
    if (this.fueraDeRango(hoy)) return;
    this.aplicar(hoy);
    this.cerrar(true);
  }

  borrar(): void {
    this.aplicar('');
    this.cerrar(true);
  }

  alTeclearDias(evento: KeyboardEvent): void {
    const elemento = evento.target as HTMLElement | null;
    const origen = elemento?.dataset['clave'] || this.claveTabulable();
    if (!origen) return;

    const fecha = this.fechaDe(origen);
    const diaSemana = (fecha.getDay() + 6) % 7;
    let destino: Date;

    switch (evento.key) {
      case 'ArrowLeft':
        destino = this.sumarDias(fecha, -1);
        break;
      case 'ArrowRight':
        destino = this.sumarDias(fecha, 1);
        break;
      case 'ArrowUp':
        destino = this.sumarDias(fecha, -7);
        break;
      case 'ArrowDown':
        destino = this.sumarDias(fecha, 7);
        break;
      case 'Home':
        destino = this.sumarDias(fecha, -diaSemana);
        break;
      case 'End':
        destino = this.sumarDias(fecha, 6 - diaSemana);
        break;
      case 'PageUp':
        destino = this.sumarMeses(fecha, evento.shiftKey ? -12 : -1);
        break;
      case 'PageDown':
        destino = this.sumarMeses(fecha, evento.shiftKey ? 12 : 1);
        break;
      default:
        return;
    }

    evento.preventDefault();
    const clave = this.acotar(this.claveDe(destino));
    if (clave === origen) return;
    this.claveEnfoque.set(clave);
    this.anioVisible.set(Number(clave.slice(0, 4)));
    this.mesVisible.set(Number(clave.slice(5, 7)) - 1);
    this.enfocarActual();
  }

  reubicar(): void {
    if (!this.abierto()) return;

    this.enHoja.set(window.matchMedia('(max-width: 560px)').matches);
    if (this.enHoja()) return;

    const boton = this.disparador()?.nativeElement;
    if (!boton) return;

    const rect = boton.getBoundingClientRect();
    const altoVentana = window.innerHeight;
    const anchoVentana = window.innerWidth;

    if (rect.bottom < 0 || rect.top > altoVentana) {
      this.cerrar(false);
      return;
    }

    const panel = this.panel()?.nativeElement;
    const anchoPanel = panel?.offsetWidth || 316;
    const altoPanel = panel?.scrollHeight || 400;
    const margen = 8;
    const separacion = 6;
    const izquierda = Math.max(margen, Math.min(rect.left, anchoVentana - anchoPanel - margen));
    const espacioAbajo = altoVentana - rect.bottom - separacion - margen;
    const espacioArriba = rect.top - separacion - margen;

    if (espacioAbajo >= altoPanel || espacioAbajo >= espacioArriba) {
      this.ubicacion.set({
        arriba: rect.bottom + separacion,
        abajo: null,
        izquierda,
        alturaMaxima: Math.max(160, espacioAbajo),
      });
      return;
    }

    this.ubicacion.set({
      arriba: null,
      abajo: altoVentana - rect.top + separacion,
      izquierda,
      alturaMaxima: Math.max(160, espacioArriba),
    });
  }

  private abrir(): void {
    const base = this.acotar(this.valorActual() || this.claveDe(new Date()));
    this.claveEnfoque.set(base);
    this.anioVisible.set(Number(base.slice(0, 4)));
    this.mesVisible.set(Number(base.slice(5, 7)) - 1);
    this.vista.set('dias');
    this.enHoja.set(window.matchMedia('(max-width: 560px)').matches);
    this.abierto.set(true);
    this.reubicar();
    this.escucharDesplazamiento(true);
    this.enfocarActual();
  }

  private moverMes(salto: number): void {
    const destino = new Date(this.anioVisible(), this.mesVisible() + salto, 1);
    this.anioVisible.set(destino.getFullYear());
    this.mesVisible.set(destino.getMonth());
  }

  private enfocarActual(): void {
    afterNextRender(
      () => {
        const panel = this.panel()?.nativeElement;
        if (!panel) return;
        const destino =
          panel.querySelector<HTMLElement>('.opciones [data-actual]:not(:disabled)') ??
          panel.querySelector<HTMLElement>('.opciones button:not(:disabled)') ??
          panel;
        destino.focus();
        this.reubicar();
      },
      { injector: this.injector },
    );
  }

  private escucharDesplazamiento(activo: boolean): void {
    if (activo) {
      document.addEventListener('scroll', this.alDesplazar, { capture: true, passive: true });
      return;
    }
    document.removeEventListener('scroll', this.alDesplazar, { capture: true });
  }

  private completarNacimiento(): void {
    const anio = this.anioParcial();
    const mes = this.mesParcial();
    const dia = this.diaParcial();

    if (mes !== null && dia !== null) {
      const tope = this.diasDelMes(anio ?? 2000, mes);
      if (dia > tope) this.diaParcial.set(tope);
    }

    const diaFinal = this.diaParcial();
    if (anio === null || mes === null || diaFinal === null) return;

    const clave = this.acotar(this.armarClave(anio, mes, diaFinal));
    this.leer(clave);
    if (clave !== this.valorActual()) this.aplicar(clave);
    this.alTocar();
  }

  private aplicar(clave: string): void {
    this.valor.set(clave);
    this.alCambiar(clave);
  }

  private leer(clave: string): void {
    if (!clave) {
      this.diaParcial.set(null);
      this.mesParcial.set(null);
      this.anioParcial.set(null);
      return;
    }
    this.anioParcial.set(Number(clave.slice(0, 4)));
    this.mesParcial.set(Number(clave.slice(5, 7)));
    this.diaParcial.set(Number(clave.slice(8, 10)));
  }

  private normalizar(valor: unknown): string {
    if (valor instanceof Date) {
      return Number.isNaN(valor.getTime()) ? '' : this.claveDe(valor);
    }
    if (typeof valor !== 'string') return '';

    const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
    if (!partes) return '';

    const anio = Number(partes[1]);
    const mes = Number(partes[2]);
    const dia = Number(partes[3]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > this.diasDelMes(anio, mes)) return '';

    return this.armarClave(anio, mes, dia);
  }

  private fueraDeRango(clave: string): boolean {
    const minima = this.claveMinima();
    const maxima = this.claveMaxima();
    return (minima !== '' && clave < minima) || (maxima !== '' && clave > maxima);
  }

  private mesFueraDeRango(anio: number, mes: number): boolean {
    const prefijo = `${anio}-${this.dosDigitos(mes)}`;
    const minima = this.claveMinima();
    const maxima = this.claveMaxima();
    return (minima !== '' && prefijo < minima.slice(0, 7)) || (maxima !== '' && prefijo > maxima.slice(0, 7));
  }

  private acotar(clave: string): string {
    const minima = this.claveMinima();
    const maxima = this.claveMaxima();
    if (minima && clave < minima) return minima;
    if (maxima && clave > maxima) return maxima;
    return clave;
  }

  private numeroDe(texto: string): number | null {
    const numero = Number(texto);
    return texto !== '' && Number.isInteger(numero) && numero > 0 ? numero : null;
  }

  private describir(clave: string): string {
    const fecha = this.fechaDe(clave);
    return `${this.diasLargos[fecha.getDay()]} ${fecha.getDate()} de ${this.meses[fecha.getMonth()]} de ${fecha.getFullYear()}`;
  }

  private capitalizar(texto: string): string {
    return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`;
  }

  private sumarDias(fecha: Date, dias: number): Date {
    return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + dias);
  }

  private sumarMeses(fecha: Date, meses: number): Date {
    const base = new Date(fecha.getFullYear(), fecha.getMonth() + meses, 1);
    const dia = Math.min(fecha.getDate(), this.diasDelMes(base.getFullYear(), base.getMonth() + 1));
    return new Date(base.getFullYear(), base.getMonth(), dia);
  }

  private diasDelMes(anio: number, mes: number): number {
    return new Date(anio, mes, 0).getDate();
  }

  private fechaDe(clave: string): Date {
    return new Date(Number(clave.slice(0, 4)), Number(clave.slice(5, 7)) - 1, Number(clave.slice(8, 10)));
  }

  private armarClave(anio: number, mes: number, dia: number): string {
    return `${String(anio).padStart(4, '0')}-${this.dosDigitos(mes)}-${this.dosDigitos(dia)}`;
  }

  private claveDe(fecha: Date): string {
    return this.armarClave(fecha.getFullYear(), fecha.getMonth() + 1, fecha.getDate());
  }
}
