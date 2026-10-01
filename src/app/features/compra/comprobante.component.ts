import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
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

type IconoPago = 'tarjeta' | 'billetera' | 'regalo' | 'desconocido';

const SUFIJO_CANJE = /\s*\(canje\)$/i;

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
  ],
  templateUrl: './comprobante.component.html',
  styleUrl: './comprobante.component.scss',
})
export class ComprobanteComponent implements OnInit {
  private readonly ruta = inject(ActivatedRoute);
  private readonly compras = inject(ComprasService);
  private readonly pdf = inject(PdfService);
  private readonly avisos = inject(NotificacionesService);

  readonly cargando = signal(true);
  readonly descargando = signal(false);
  readonly codigo = signal('');
  readonly resumen = signal<ResumenCompra | null>(null);
  readonly qr = signal('');

  readonly cancelada = computed(() => this.resumen()?.compra.estado === 'cancelada');
  readonly utilizada = computed(() => this.resumen()?.compra.entrada_validada === true);
  readonly atenuada = computed(() => this.cancelada() || this.utilizada());
  readonly restriccion = computed(() => this.resumen()?.pelicula?.restriccion_edad ?? 0);

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
    return momento.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
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
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
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
      const encontrada = await this.compras.buscarPorCodigo(codigo);
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

  private momentoFuncion(): Date | null {
    const inicio = this.resumen()?.funcion?.inicio;
    if (!inicio) {
      return null;
    }
    const momento = new Date(inicio);
    return Number.isNaN(momento.getTime()) ? null : momento;
  }
}
