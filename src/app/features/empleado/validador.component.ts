import { Component, ElementRef, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Html5Qrcode } from 'html5-qrcode';
import { AuthService } from '../../core/services/auth.service';
import { ComprasService } from '../../core/services/compras.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { ResultadoValidacion } from '../../core/models/modelos';
import { AvisosComponent } from '../../shared/components/avisos.component';

type ModoValidacion = 'entrada' | 'candy';
type PestaniaIngreso = 'escanear' | 'manual';

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

  readonly modo = signal<ModoValidacion>('entrada');
  readonly pestania = signal<PestaniaIngreso>('escanear');
  readonly escaneando = signal(false);
  readonly abriendoCamara = signal(false);
  readonly camaraBloqueada = signal(false);
  readonly validando = signal(false);
  readonly saliendo = signal(false);
  readonly resultado = signal<ResultadoValidacion | null>(null);
  readonly modoResultado = signal<ModoValidacion>('entrada');
  readonly ultimoCodigo = signal('');
  readonly historial = signal<RegistroValidacion[]>([]);

  readonly formulario = this.fb.nonNullable.group({
    codigo: ['', [Validators.required, Validators.minLength(4)]],
  });

  readonly nombre = computed(() => this.auth.nombreCompleto() || 'Empleado');

  readonly inicial = computed(() => this.nombre().charAt(0).toUpperCase());

  readonly etiquetaModo = computed(() =>
    this.modo() === 'entrada' ? 'Entrada a sala' : 'Candy bar',
  );

  readonly tituloResultado = computed(() => {
    const salida = this.resultado();
    if (!salida) return '';
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
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

    return texto.charAt(0).toUpperCase() + texto.slice(1);
  });

  readonly validadas = computed(() => this.historial().filter(registro => registro.ok).length);

  readonly rechazadas = computed(() => this.historial().length - this.validadas());

  cambiarModo(valor: ModoValidacion): void {
    if (this.modo() === valor) return;
    this.modo.set(valor);
    this.resultado.set(null);
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

    try {
      const lector = new Html5Qrcode(ID_LECTOR);
      this.lector = lector;

      await lector.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 250 },
        textoLeido => {
          void this.alLeerCodigo(textoLeido);
        },
        undefined,
      );

      this.escaneando.set(true);
    } catch {
      this.lector = null;
      this.escaneando.set(false);
      this.camaraBloqueada.set(true);
      this.avisos.error('No pudimos usar la cámara. Cargá el código a mano');
    } finally {
      this.abriendoCamara.set(false);
    }
  }

  async detenerCamara(): Promise<void> {
    const lector = this.lector;
    this.lector = null;
    this.escaneando.set(false);

    if (!lector) return;

    try {
      if (lector.isScanning) await lector.stop();
      lector.clear();
    } catch {
      this.lector = null;
    }
  }

  async validarManual(): Promise<void> {
    const control = this.formulario.controls.codigo;

    if (this.formulario.invalid) {
      control.markAsTouched();
      this.avisos.error('Escribí el código que figura en la entrada');
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
    const limpio = campo.value.toUpperCase().replace(/\s+/g, '');

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
