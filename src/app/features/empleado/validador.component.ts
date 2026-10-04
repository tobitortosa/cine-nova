import { Component, ElementRef, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { AuthService } from '../../core/services/auth.service';
import { ComprasService } from '../../core/services/compras.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { ResultadoValidacion } from '../../core/models/modelos';
import { AvisosComponent } from '../../shared/components/avisos.component';
import { ZONA_HORARIA, hoyLocal } from '../../shared/utils/ventas';

type ModoValidacion = 'entrada' | 'candy';
type PestaniaIngreso = 'escanear' | 'manual';
type ProblemaCamara = 'permiso' | 'sin-camara' | 'ocupada' | 'no-soportada';

interface RegistroValidacion {
  id: number;
  hora: string;
  codigo: string;
  modo: ModoValidacion;
  ok: boolean;
  detalle: string;
}

interface ProductoValidado {
  nombre: string;
  cantidad: number;
}

const ID_LECTOR = 'lector-qr';
const TOPE_HISTORIAL = 25;
const CLAVE_MODO = 'cinenova_validador_modo';
const FORMATO_CODIGO = /^[0-9A-F]{12}$/;
const OTRO_DIA = /^(La entrada|El pedido) es para /i;

const TEXTOS_CAMARA: Record<ProblemaCamara, { titulo: string; texto: string }> = {
  permiso: {
    titulo: 'No tenemos permiso para usar la cámara',
    texto: 'Habilitá la cámara desde los ajustes del navegador o validá el código a mano.',
  },
  'sin-camara': {
    titulo: 'No encontramos una cámara disponible',
    texto: 'Revisá que el dispositivo tenga cámara o validá el código a mano.',
  },
  ocupada: {
    titulo: 'La cámara está ocupada',
    texto: 'Cerrá otras aplicaciones o pestañas que la estén usando y probá de nuevo.',
  },
  'no-soportada': {
    titulo: 'Este navegador no permite usar la cámara',
    texto: 'Abrí el validador desde Chrome o Safari actualizados, o validá el código a mano.',
  },
};

function leerModo(): ModoValidacion {
  try {
    return localStorage.getItem(CLAVE_MODO) === 'candy' ? 'candy' : 'entrada';
  } catch {
    return 'entrada';
  }
}

function guardarModo(modo: ModoValidacion): void {
  try {
    localStorage.setItem(CLAVE_MODO, modo);
  } catch {
    return;
  }
}

function problemaDe(error: unknown): ProblemaCamara {
  const texto = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/NotAllowedError|SecurityError|Permission|denied/i.test(texto)) return 'permiso';
  if (/NotReadableError|TrackStartError|AbortError|in use/i.test(texto)) return 'ocupada';
  if (/not supported|mediaDevices|secure context/i.test(texto)) return 'no-soportada';
  return 'sin-camara';
}

function diaYHora(momento: Date): string {
  const partes = new Intl.DateTimeFormat('es-AR', {
    timeZone: ZONA_HORARIA,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(momento);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find(parte => parte.type === tipo)?.value ?? '';
  return `${valor('day')}/${valor('month')} a las ${valor('hour')}:${valor('minute')}`;
}

@Component({
  selector: 'app-validador',
  imports: [ReactiveFormsModule, AvisosComponent],
  templateUrl: './validador.component.html',
  styleUrl: './validador.component.scss',
})
export class ValidadorComponent implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly compras = inject(ComprasService);
  private readonly avisos = inject(NotificacionesService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  private readonly campoCodigo = viewChild<ElementRef<HTMLInputElement>>('campoCodigo');

  private lector: Html5Qrcode | null = null;
  private contador = 0;

  readonly modo = signal<ModoValidacion>(leerModo());
  readonly pestania = signal<PestaniaIngreso>('escanear');
  readonly escaneando = signal(false);
  readonly abriendoCamara = signal(false);
  readonly camaraBloqueada = signal(false);
  readonly problemaCamara = signal<ProblemaCamara>('permiso');
  readonly validando = signal(false);
  readonly saliendo = signal(false);
  readonly resultado = signal<ResultadoValidacion | null>(null);
  readonly modoResultado = signal<ModoValidacion>('entrada');
  readonly ultimoCodigo = signal('');
  readonly historial = signal<RegistroValidacion[]>([]);

  readonly formulario = this.fb.nonNullable.group({
    codigo: ['', [Validators.required, Validators.pattern(FORMATO_CODIGO)]],
  });

  readonly nombre = computed(() => this.auth.nombreCompleto() || 'Empleado');

  readonly inicial = computed(() => this.nombre().charAt(0).toUpperCase());

  readonly etiquetaModo = computed(() =>
    this.modo() === 'entrada' ? 'Entrada a sala' : 'Candy bar',
  );

  readonly ayudaReposo = computed(() =>
    this.modo() === 'entrada'
      ? 'Apuntá al código QR de la entrada'
      : 'Apuntá al código QR para entregar el pedido del candy',
  );

  readonly textosCamara = computed(() => TEXTOS_CAMARA[this.problemaCamara()]);

  readonly esOtroDia = computed(() => {
    const salida = this.resultado();
    return !!salida && !salida.ok && OTRO_DIA.test(salida.motivo?.trim() ?? '');
  });

  readonly tituloResultado = computed(() => {
    const salida = this.resultado();
    if (!salida) return '';
    if (this.esOtroDia()) return 'NO ES PARA HOY';
    if (!salida.ok) return 'NO VÁLIDA';
    return this.modoResultado() === 'entrada' ? 'ENTRADA VÁLIDA' : 'PRODUCTOS ENTREGADOS';
  });

  readonly motivoResultado = computed(
    () => this.resultado()?.motivo?.trim() || 'El código no se pudo validar',
  );

  readonly codigoResultado = computed(() => this.resultado()?.codigo ?? this.ultimoCodigo());

  readonly butacas = computed<string[]>(() => this.resultado()?.butacas ?? []);

  readonly productos = computed<ProductoValidado[]>(() => this.resultado()?.items ?? []);

  readonly funcionResultado = computed(() => {
    const inicio = this.resultado()?.inicio;
    if (!inicio) return '';

    const momento = new Date(inicio);
    if (Number.isNaN(momento.getTime())) return '';

    const texto = momento.toLocaleString('es-AR', {
      timeZone: ZONA_HORARIA,
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

    return texto.charAt(0).toUpperCase() + texto.slice(1);
  });

  readonly avisoCandy = computed(() => {
    const salida = this.resultado();
    if (!salida?.ok || this.modoResultado() !== 'candy' || !salida.inicio) return '';

    const momento = new Date(salida.inicio);
    if (Number.isNaN(momento.getTime())) return '';

    const dia = hoyLocal(momento);
    const hoy = hoyLocal();
    if (dia === hoy) return '';

    return dia < hoy
      ? `El pedido era para la función del ${diaYHora(momento)}, que ya pasó.`
      : `El pedido es para la función del ${diaYHora(momento)}, que todavía no empezó.`;
  });

  readonly validadas = computed(() => this.historial().filter(registro => registro.ok).length);

  readonly rechazadas = computed(() => this.historial().length - this.validadas());

  cambiarModo(valor: ModoValidacion): void {
    if (this.modo() === valor) return;
    this.modo.set(valor);
    this.resultado.set(null);
    guardarModo(valor);
  }

  async cambiarPestania(valor: PestaniaIngreso): Promise<void> {
    if (this.pestania() === valor) return;

    await this.detenerCamara();
    this.pestania.set(valor);

    if (valor === 'manual') {
      setTimeout(() => this.campoCodigo()?.nativeElement.focus(), 60);
    }
  }

  async iniciarCamara(): Promise<void> {
    if (this.escaneando() || this.abriendoCamara()) return;

    this.abriendoCamara.set(true);
    this.camaraBloqueada.set(false);

    let lector: Html5Qrcode | null = null;

    try {
      const nuevo = new Html5Qrcode(ID_LECTOR);
      lector = nuevo;
      this.lector = nuevo;

      await nuevo.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 250 },
        textoLeido => {
          if (this.lector !== nuevo) return;
          void this.alLeerCodigo(textoLeido);
        },
        undefined,
      );

      if (this.lector !== nuevo) {
        await this.apagar(nuevo);
        return;
      }

      this.escaneando.set(true);
    } catch (error) {
      if (lector && this.lector !== lector) return;

      this.lector = null;
      this.escaneando.set(false);
      this.problemaCamara.set(problemaDe(error));
      this.camaraBloqueada.set(true);
      this.avisos.error(`${this.textosCamara().titulo}. Cargá el código a mano`);
    } finally {
      this.abriendoCamara.set(false);
    }
  }

  async detenerCamara(): Promise<void> {
    const lector = this.lector;
    this.lector = null;
    this.escaneando.set(false);

    if (!lector) return;

    const apagado = await this.apagar(lector);
    if (!apagado) return;

    try {
      lector.clear();
    } catch {
      return;
    }
  }

  async validarManual(): Promise<void> {
    const control = this.formulario.controls.codigo;

    if (this.formulario.invalid) {
      control.markAsTouched();
      this.avisos.error('El código tiene 12 caracteres: números del 0 al 9 y letras de la A a la F');
      return;
    }

    await this.validar(control.value);
  }

  async validarOtro(): Promise<void> {
    this.resultado.set(null);
    this.formulario.reset({ codigo: '' });

    if (this.pestania() === 'escanear' && !this.camaraBloqueada()) {
      await this.iniciarCamara();
      return;
    }

    setTimeout(() => this.campoCodigo()?.nativeElement.focus(), 60);
  }

  normalizar(evento: Event): void {
    const campo = evento.target as HTMLInputElement;
    const limpio = campo.value
      .toUpperCase()
      .replace(/O/g, '0')
      .replace(/[^0-9A-F]/g, '')
      .slice(0, 12);

    campo.value = limpio;
    this.formulario.controls.codigo.setValue(limpio, { emitEvent: false });
  }

  async salir(): Promise<void> {
    if (this.saliendo()) return;

    this.saliendo.set(true);
    await this.detenerCamara();

    try {
      await this.auth.salir();
      await this.router.navigate(['/']);
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No pudimos cerrar la sesión');
    } finally {
      this.saliendo.set(false);
    }
  }

  ngOnDestroy(): void {
    void this.detenerCamara();
  }

  private async apagar(lector: Html5Qrcode): Promise<boolean> {
    try {
      const estado = lector.getState();
      if (estado === Html5QrcodeScannerState.SCANNING || estado === Html5QrcodeScannerState.PAUSED) {
        await lector.stop();
      }
      return true;
    } catch {
      return false;
    }
  }

  private async alLeerCodigo(texto: string): Promise<void> {
    if (this.validando()) return;

    await this.detenerCamara();
    await this.validar(texto);
  }

  private async validar(codigo: string): Promise<void> {
    const limpio = (codigo ?? '').trim().toUpperCase();

    if (!limpio) {
      this.avisos.error('Ingresá un código para validar');
      return;
    }

    const modoUsado = this.modo();

    this.validando.set(true);
    this.resultado.set(null);
    this.ultimoCodigo.set(limpio);
    this.modoResultado.set(modoUsado);

    try {
      const salida = await this.compras.validarQr(limpio, modoUsado);

      this.resultado.set(salida);
      this.registrar(limpio, modoUsado, salida);
      this.avisar(salida.ok);

      if (salida.ok) {
        this.formulario.reset({ codigo: '' });
      }
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : 'Ocurrió un error al validar';
      const fallido: ResultadoValidacion = { ok: false, motivo: mensaje, codigo: limpio };

      this.resultado.set(fallido);
      this.registrar(limpio, modoUsado, fallido);
      this.avisar(false);
    } finally {
      this.validando.set(false);
    }
  }

  private registrar(codigo: string, modo: ModoValidacion, salida: ResultadoValidacion): void {
    this.contador += 1;

    const registro: RegistroValidacion = {
      id: this.contador,
      hora: new Date().toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      codigo,
      modo,
      ok: salida.ok,
      detalle: salida.ok
        ? (salida.pelicula ?? 'Validación correcta')
        : (salida.motivo?.trim() || 'Rechazada'),
    };

    this.historial.update(actuales => [registro, ...actuales].slice(0, TOPE_HISTORIAL));
  }

  private avisar(ok: boolean): void {
    this.vibrar(ok);

    if (ok) {
      this.avisos.exito(
        this.modoResultado() === 'entrada' ? 'Entrada válida' : 'Productos entregados',
      );
      return;
    }

    this.avisos.error(this.motivoResultado());
  }

  private vibrar(ok: boolean): void {
    try {
      if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
      navigator.vibrate(ok ? 200 : [90, 70, 90, 70, 90]);
    } catch {
      return;
    }
  }
}
