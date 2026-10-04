import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ComprasService } from '../../core/services/compras.service';
import { FuncionesService } from '../../core/services/funciones.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { Compra, ResumenCompra } from '../../core/models/modelos';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { MedioPagoPipe } from '../../shared/pipes/medio-pago.pipe';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { ConfirmarComponent } from '../../shared/components/confirmar.component';

const MARGEN_CANCELACION_MS = 2 * 60 * 60 * 1000;

@Component({
  selector: 'app-mis-compras',
  imports: [
    RouterLink,
    RouterLinkActive,
    PrecioPipe,
    MedioPagoPipe,
    CargandoComponent,
    VacioComponent,
    ConfirmarComponent,
  ],
  templateUrl: './mis-compras.component.html',
  styleUrl: './mis-compras.component.scss',
})
export class MisComprasComponent implements OnInit {
  private readonly compras = inject(ComprasService);
  private readonly funciones = inject(FuncionesService);
  private readonly auth = inject(AuthService);
  private readonly avisos = inject(NotificacionesService);

  readonly exacto = { exact: true };

  readonly lista = signal<Compra[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly confirmando = signal(false);
  readonly cancelando = signal(false);
  readonly elegida = signal<Compra | null>(null);

  private readonly salas = signal<Map<number, string>>(new Map());
  private readonly detalles = signal<Map<number, ResumenCompra>>(new Map());

  private readonly formatoFecha = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  private readonly formatoCorto = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  private readonly formatoNumero = new Intl.NumberFormat('es-AR');

  readonly textoConfirmacion = computed(() => {
    const compra = this.elegida();
    if (!compra) return '';

    const base = `Vas a cancelar la compra ${compra.codigo}. El importe se te devuelve como crédito en tu cuenta de CineNova para usar en próximas compras, no como dinero.`;
    const puntos = compra.puntos_ganados ?? 0;
    if (puntos <= 0) return base;

    const cantidad = puntos === 1 ? '1 punto' : `${this.formatoNumero.format(puntos)} puntos`;
    return `${base} También se te descuentan los ${cantidad} que sumaste con esta compra.`;
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set('');

    try {
      const [compras, salas] = await Promise.all([
        this.compras.misCompras(),
        this.funciones.salas().catch(() => []),
      ]);

      this.lista.set(compras);
      this.salas.set(new Map(salas.map((sala) => [sala.id, sala.nombre])));
      await this.cargarDetalles(compras);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No pudimos cargar tus compras');
    } finally {
      this.cargando.set(false);
    }
  }

  private async cargarDetalles(compras: Compra[]): Promise<void> {
    if (compras.length === 0) {
      this.detalles.set(new Map());
      return;
    }

    const resumenes = await Promise.all(
      compras.map((compra) => this.compras.buscarPorCodigo(compra.codigo).catch(() => null)),
    );

    const mapa = new Map<number, ResumenCompra>();

    compras.forEach((compra, indice) => {
      const resumen = resumenes[indice];
      if (resumen) mapa.set(compra.id, resumen);
    });

    this.detalles.set(mapa);
  }

  tituloDe(compra: Compra): string {
    return compra.funcion?.pelicula?.titulo ?? 'Función no disponible';
  }

  aficheDe(compra: Compra): string | null {
    return compra.funcion?.pelicula?.imagen_url ?? null;
  }

  fechaFuncionDe(compra: Compra): string {
    const inicio = compra.funcion?.inicio;
    if (!inicio) return 'Sin función asociada';

    const momento = new Date(inicio);
    if (Number.isNaN(momento.getTime())) return 'Sin función asociada';

    return this.formatoFecha.format(momento);
  }

  fechaCompraDe(compra: Compra): string {
    const momento = new Date(compra.creado_en);
    if (Number.isNaN(momento.getTime())) return '';

    return this.formatoCorto.format(momento);
  }

  salaDe(compra: Compra): string {
    const resumen = this.detalles().get(compra.id);
    if (resumen?.sala) return resumen.sala;

    const salaId = compra.funcion?.sala_id;
    if (salaId === undefined || salaId === null) return 'Sala a confirmar';

    return this.salas().get(salaId) ?? 'Sala a confirmar';
  }

  entradasDe(compra: Compra): number | null {
    const resumen = this.detalles().get(compra.id);
    return resumen ? resumen.butacas.length : null;
  }

  estadoDe(compra: Compra): 'cancelada' | 'utilizada' | 'pagada' {
    if (compra.estado === 'cancelada') return 'cancelada';
    if (compra.entrada_validada) return 'utilizada';
    return 'pagada';
  }

  puedeCancelar(compra: Compra): boolean {
    if (compra.estado !== 'pagada' || compra.entrada_validada || compra.productos_entregados) return false;

    const inicio = compra.funcion?.inicio;
    if (!inicio) return true;

    const marca = new Date(inicio).getTime();
    if (Number.isNaN(marca)) return true;

    return marca - Date.now() > MARGEN_CANCELACION_MS;
  }

  async pedirCancelacion(compra: Compra): Promise<void> {
    if (this.cancelando()) return;

    const puntos = compra.puntos_ganados ?? 0;
    if (puntos > 0) {
      await this.auth.refrescarPerfil().catch(() => undefined);
      const disponibles = this.auth.perfil()?.puntos;
      if (disponibles !== undefined && disponibles < puntos) {
        this.avisos.error('Ya usaste los puntos que sumaste con esta compra, por eso no se puede cancelar');
        return;
      }
    }

    this.elegida.set(compra);
    this.confirmando.set(true);
  }

  async confirmarCancelacion(): Promise<void> {
    const compra = this.elegida();
    if (!compra || this.cancelando()) return;

    this.cancelando.set(true);

    try {
      await this.compras.cancelar(compra.id);
      this.avisos.exito('Cancelamos la compra y acreditamos el importe como crédito');

      await this.cargar();
      await this.auth.refrescarPerfil();
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No pudimos cancelar la compra');
    } finally {
      this.cancelando.set(false);
      this.elegida.set(null);
    }
  }
}
