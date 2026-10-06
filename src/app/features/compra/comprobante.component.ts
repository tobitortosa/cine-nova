import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ComprasService } from '../../core/services/compras.service';
import { PdfService } from '../../core/services/pdf.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { ResumenCompra } from '../../core/models/modelos';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { DuracionPipe } from '../../shared/pipes/duracion.pipe';
import { RestriccionPipe } from '../../shared/pipes/restriccion.pipe';
import { MedioPagoPipe } from '../../shared/pipes/medio-pago.pipe';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { ZONA_HORARIA } from '../../shared/utils/ventas';
import { avisoCompraMenor, avisoRestriccion } from '../../shared/utils/restriccion';
import { CancelarInvitadoComponent } from './cancelar-invitado.component';

type IconoPago = 'tarjeta' | 'billetera' | 'regalo' | 'desconocido';

type SeccionCancelar = 'invitado' | 'propia' | 'cuenta' | 'otra' | null;

const MARGEN_CANCELACION_MS = 2 * 60 * 60 * 1000;

const SUFIJO_CANJE = /\s*\(canje\)$/i;

function enmascararEmail(email: string | null | undefined): string {
  const limpio = (email ?? '').trim();
  if (!limpio || limpio.includes('•')) return limpio;

  const arroba = limpio.indexOf('@');
  if (arroba <= 0) return '••••';

  const usuario = limpio.slice(0, arroba);
  const visible = usuario.length > 2 ? usuario.slice(0, 2) : usuario.slice(0, 1);
  return `${visible}••••${limpio.slice(arroba)}`;
}

function resguardar(resumen: ResumenCompra | null): ResumenCompra | null {
  if (!resumen?.compra) return resumen;
  return {
    ...resumen,
    compra: {
      ...resumen.compra,
      usuario_id: null,
      email_contacto: enmascararEmail(resumen.compra.email_contacto),
    },
  };
}

@Component({
  selector: 'app-comprobante',
  imports: [
    RouterLink,
    PrecioPipe,
    DuracionPipe,
    RestriccionPipe,
    MedioPagoPipe,
    CargandoComponent,
    VacioComponent,
    CancelarInvitadoComponent,
  ],
  templateUrl: './comprobante.component.html',
  styleUrl: './comprobante.component.scss',
})
export class ComprobanteComponent implements OnInit {
  private readonly ruta = inject(ActivatedRoute);
  private readonly compras = inject(ComprasService);
  private readonly pdf = inject(PdfService);
  private readonly avisos = inject(NotificacionesService);
  private readonly auth = inject(AuthService);
  private readonly anfitrion = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  readonly cargando = signal(true);
  readonly descargando = signal(false);
  readonly codigo = signal('');
  readonly resumen = signal<ResumenCompra | null>(null);
  readonly qr = signal('');
  readonly creditoAcreditado = signal<number | null>(null);

  readonly cancelada = computed(() => this.resumen()?.compra.estado === 'cancelada');
  readonly utilizada = computed(() => this.resumen()?.compra.entrada_validada === true);
  readonly candyPendiente = computed(
    () =>
      (this.resumen()?.items.length ?? 0) > 0 &&
      this.resumen()?.compra.productos_entregados !== true,
  );
  readonly agotada = computed(() => this.utilizada() && !this.candyPendiente());
  readonly atenuada = computed(() => this.cancelada() || this.agotada());
  readonly restriccion = computed(() => this.resumen()?.pelicula?.restriccion_edad ?? 0);
  readonly avisoEdad = computed(() => avisoRestriccion(this.restriccion()));
  readonly esMenor = computed(() => this.resumen()?.compra.requiere_adulto === true);
  readonly avisoMenor = computed(() => {
    const compra = this.resumen()?.compra;
    return avisoCompraMenor(compra?.requiere_adulto, compra?.adulto_codigo);
  });
  readonly descuentoCombos = computed(() => Number(this.resumen()?.compra.descuento_combos ?? 0));
  readonly email = computed(() => this.resumen()?.compra.email_contacto ?? '');

  readonly cancelable = computed(() => {
    const compra = this.resumen()?.compra;
    if (!compra || compra.estado !== 'pagada' || compra.entrada_validada || compra.productos_entregados) {
      return false;
    }
    const momento = this.momentoFuncion();
    return !momento || momento.getTime() - Date.now() > MARGEN_CANCELACION_MS;
  });

  readonly seccionCancelar = computed<SeccionCancelar>(() => {
    const resumen = this.resumen();
    if (!resumen || resumen.con_cuenta === undefined || this.creditoAcreditado() !== null) return null;
    if (!this.cancelable() || this.auth.cargando() || this.auth.esEmpleado()) return null;
    if (resumen.propia) return 'propia';
    if (resumen.con_cuenta) return this.auth.estaLogueado() ? 'otra' : 'cuenta';
    return 'invitado';
  });

  readonly montoCredito = computed(() => {
    const compra = this.resumen()?.compra;
    return compra ? Number(compra.total) + Number(compra.credito_usado) : 0;
  });

  readonly limiteCancelacion = computed(() => {
    const momento = this.momentoFuncion();
    if (!momento) return '';
    const limite = new Date(momento.getTime() - MARGEN_CANCELACION_MS);
    const dia = limite
      .toLocaleDateString('es-AR', {
        timeZone: ZONA_HORARIA,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
      .replace(',', '');
    const hora = limite.toLocaleTimeString('es-AR', {
      timeZone: ZONA_HORARIA,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    return `el ${dia} a las ${hora} h`;
  });

  readonly plazoCancelacion = computed(() => this.limiteCancelacion() || '2 horas antes de la función');

  readonly items = computed(() =>
    (this.resumen()?.items ?? []).map((item) => {
      const canje = Number(item.precio_unitario) === 0 && SUFIJO_CANJE.test(item.nombre);
      return {
        ...item,
        canje,
        nombre: canje ? item.nombre.replace(SUFIJO_CANJE, '') : item.nombre,
      };
    }),
  );

  readonly iconoPago = computed<IconoPago>(() => {
    switch (this.resumen()?.compra.medio_pago) {
      case 'tarjeta_credito':
      case 'tarjeta_debito':
        return 'tarjeta';
      case 'mercado_pago':
        return 'billetera';
      case 'sin_cargo':
        return 'regalo';
      default:
        return 'desconocido';
    }
  });

  readonly fechaFuncion = computed(() => {
    const momento = this.momentoFuncion();
    if (!momento) {
      return 'Fecha a confirmar';
    }
    const texto = momento.toLocaleDateString('es-AR', {
      timeZone: ZONA_HORARIA,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  });

  readonly horaFuncion = computed(() => {
    const momento = this.momentoFuncion();
    if (!momento) {
      return 'A confirmar';
    }
    return momento.toLocaleTimeString('es-AR', {
      timeZone: ZONA_HORARIA,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  });

  readonly idiomaFuncion = computed(() => {
    const idioma = this.resumen()?.funcion?.idioma;
    if (!idioma) {
      return 'A confirmar';
    }
    return idioma === 'castellano' ? 'Castellano' : 'Subtitulada';
  });

  readonly emitida = computed(() => {
    const creado = this.resumen()?.compra.creado_en;
    if (!creado) {
      return '';
    }
    const momento = new Date(creado);
    if (Number.isNaN(momento.getTime())) {
      return '';
    }
    return momento.toLocaleString('es-AR', {
      timeZone: ZONA_HORARIA,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  });

  async ngOnInit(): Promise<void> {
    const codigo = (this.ruta.snapshot.paramMap.get('codigo') ?? '').trim();
    this.codigo.set(codigo);

    if (!codigo) {
      this.cargando.set(false);
      return;
    }

    try {
      const [resumen] = await Promise.all([
        this.compras.buscarPorCodigo(codigo),
        this.auth.inicializar().catch(() => undefined),
      ]);
      const encontrada = resguardar(resumen);
      this.resumen.set(encontrada);

      if (encontrada?.compra?.codigo) {
        this.qr.set(await this.pdf.qr(encontrada.compra.codigo));
      }
    } catch (error) {
      this.avisos.error(
        error instanceof Error ? error.message : 'No se pudo buscar la compra',
      );
    } finally {
      this.cargando.set(false);
      this.irAlAncla();
    }
  }

  async alCancelar(credito: number): Promise<void> {
    this.creditoAcreditado.set(credito);
    await this.recargar();
  }

  async recargar(): Promise<void> {
    const codigo = this.codigo();
    if (!codigo) return;

    try {
      const encontrada = resguardar(await this.compras.buscarPorCodigo(codigo));
      if (encontrada) this.resumen.set(encontrada);
    } catch {
      this.avisos.error('No pudimos actualizar el estado de la compra. Recargá la página.');
    }
  }

  async descargar(): Promise<void> {
    const actual = this.resumen();
    if (!actual || this.descargando()) {
      return;
    }

    this.descargando.set(true);

    try {
      await this.pdf.generarEntrada(actual);
      this.avisos.exito('Descargamos tu entrada en PDF');
    } catch (error) {
      this.avisos.error(
        error instanceof Error ? error.message : 'No se pudo generar el PDF',
      );
    } finally {
      this.descargando.set(false);
    }
  }

  private irAlAncla(): void {
    const ancla = this.ruta.snapshot.fragment;
    if (!ancla || this.destroyRef.destroyed) return;

    afterNextRender(
      () => {
        const destino = this.anfitrion.nativeElement.ownerDocument.getElementById(ancla);
        destino?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      { injector: this.injector },
    );
  }

  private momentoFuncion(): Date | null {
    const inicio = this.resumen()?.funcion?.inicio;
    if (!inicio) {
      return null;
    }
    const momento = new Date(inicio);
    return Number.isNaN(momento.getTime()) ? null : momento;
  }
}
