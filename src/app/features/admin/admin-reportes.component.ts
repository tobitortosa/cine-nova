import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FilaFacturacion, PeliculaVista, TopProducto } from '../../core/models/modelos';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { ReportesService } from '../../core/services/reportes.service';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';
import { SelectorFechaComponent } from '../../shared/components/selector-fecha.component';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { MESES } from '../../shared/utils/calendario';

type Agrupacion = 'semana' | 'mes';
type Atajo = 'hoy' | 'semana' | 'mes';

interface Totales {
  compras: number;
  entradas: number;
  productos: number;
  facturado: number;
}

interface BarraDia {
  clave: string;
  x: number;
  y: number;
  ancho: number;
  alto: number;
  zonaX: number;
  zonaAncho: number;
  centro: number;
  porcentajeX: number;
  etiqueta: string;
  etiquetaVisible: boolean;
  dia: string;
  monto: number;
}

interface BarraVista {
  titulo: string;
  vistas: number;
  porcentaje: number;
}

interface GrupoVistas {
  periodo: string;
  titulo: string;
  orden: number;
  filas: BarraVista[];
}

const ANCHO = 560;
const MARGEN = 12;
const BASE = 164;
const TOPE = 16;

function clave(fecha: Date): string {
  const mes = `${fecha.getMonth() + 1}`.padStart(2, '0');
  const dia = `${fecha.getDate()}`.padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

function aFecha(iso: string): Date {
  const partes = (iso ?? '').slice(0, 10).split('-');
  return new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
}

@Component({
  selector: 'app-admin-reportes',
  imports: [ReactiveFormsModule, CargandoComponent, VacioComponent, SelectorFechaComponent, PrecioPipe],
  templateUrl: './admin-reportes.component.html',
  styleUrl: './admin-reportes.component.scss',
})
export class AdminReportesComponent implements OnInit {
  private readonly reportes = inject(ReportesService);
  private readonly avisos = inject(NotificacionesService);
  private readonly fb = inject(FormBuilder);

  readonly formulario = this.fb.nonNullable.group({
    desde: [clave(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), Validators.required],
    hasta: [clave(new Date()), Validators.required],
  });

  readonly filas = signal<FilaFacturacion[]>([]);
  readonly vistas = signal<PeliculaVista[]>([]);
  readonly productos = signal<TopProducto[]>([]);
  readonly agrupacion = signal<Agrupacion>('semana');
  readonly agrupacionCargada = signal<Agrupacion>('semana');
  readonly rango = signal<{ desde: string; hasta: string }>({ desde: '', hasta: '' });
  readonly generando = signal(false);
  readonly generado = signal(false);
  readonly cargandoVistas = signal(true);
  readonly cargandoProductos = signal(true);
  readonly barraActiva = signal(-1);

  readonly guias = [TOPE, 53, 90, 127];

  readonly totales = computed<Totales>(() =>
    this.filas().reduce<Totales>(
      (acumulado, fila) => ({
        compras: acumulado.compras + fila.compras,
        entradas: acumulado.entradas + fila.entradas,
        productos: acumulado.productos + fila.productos,
        facturado: acumulado.facturado + fila.facturado,
      }),
      { compras: 0, entradas: 0, productos: 0, facturado: 0 },
    ),
  );

  readonly pico = computed(() =>
    this.filas().reduce((maximo, fila) => Math.max(maximo, fila.facturado), 0),
  );

  readonly barras = computed<BarraDia[]>(() => {
    const filas = this.filas();
    if (filas.length === 0) return [];

    const maximo = Math.max(this.pico(), 1);
    const util = ANCHO - MARGEN * 2;
    const paso = util / filas.length;
    const ancho = Math.min(30, paso * 0.56);
    const disponible = BASE - TOPE;
    const salto = Math.ceil(filas.length / 14);

    return filas.map((fila, indice) => {
      const alto = fila.facturado > 0 ? Math.max(4, (fila.facturado / maximo) * disponible) : 0;
      const zonaX = MARGEN + paso * indice;
      const x = zonaX + (paso - ancho) / 2;
      const centro = x + ancho / 2;

      return {
        clave: fila.dia,
        x,
        y: BASE - alto,
        ancho,
        alto,
        zonaX,
        zonaAncho: paso,
        centro,
        porcentajeX: (centro / ANCHO) * 100,
        etiqueta: fila.dia.slice(8, 10),
        etiquetaVisible: indice % salto === 0,
        dia: this.fechaLarga(fila.dia),
        monto: fila.facturado,
      };
    });
  });

  readonly barraSeleccionada = computed<BarraDia | null>(
    () => this.barras()[this.barraActiva()] ?? null,
  );

  readonly grupos = computed<GrupoVistas[]>(() => {
    const mapa = new Map<string, PeliculaVista[]>();

    for (const fila of this.vistas()) {
      const lista = mapa.get(fila.periodo) ?? [];
      lista.push(fila);
      mapa.set(fila.periodo, lista);
    }

    const agrupacion = this.agrupacionCargada();

    return Array.from(mapa.entries())
      .map(([periodo, filas], indice) => {
        const maximo = Math.max(...filas.map((fila) => fila.vistas), 1);
        const inicio = this.inicioDePeriodo(periodo, agrupacion);
        return {
          periodo,
          titulo: this.tituloPeriodo(periodo, inicio, agrupacion),
          orden: inicio ? inicio.getTime() : -indice,
          filas: [...filas]
            .sort((a, b) => b.vistas - a.vistas)
            .map((fila) => ({
              titulo: fila.titulo,
              vistas: fila.vistas,
              porcentaje: Math.max(6, (fila.vistas / maximo) * 100),
            })),
        };
      })
      .sort((a, b) => b.orden - a.orden);
  });

  readonly masVendido = computed<TopProducto | null>(() => this.productos()[0] ?? null);

  async ngOnInit(): Promise<void> {
    await Promise.all([this.generar(), this.cargarVistas(), this.cargarProductos()]);
  }

  async generar(): Promise<void> {
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      this.avisos.error('Completá las dos fechas del período');
      return;
    }

    const { desde, hasta } = this.formulario.getRawValue();

    if (desde > hasta) {
      this.avisos.error('La fecha de inicio no puede ser posterior a la de fin');
      return;
    }

    this.generando.set(true);
    this.barraActiva.set(-1);

    try {
      this.filas.set(await this.reportes.facturacion(desde, hasta));
      this.rango.set({ desde, hasta });
      this.generado.set(true);
    } catch (error) {
      this.avisos.error(error instanceof Error ? error.message : 'No se pudo generar el reporte');
    } finally {
      this.generando.set(false);
    }
  }

  async atajo(cual: Atajo): Promise<void> {
    const hoy = new Date();

    if (cual === 'hoy') {
      this.formulario.patchValue({ desde: clave(hoy), hasta: clave(hoy) });
    } else if (cual === 'semana') {
      const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 6);
      this.formulario.patchValue({ desde: clave(inicio), hasta: clave(hoy) });
    } else {
      const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      this.formulario.patchValue({ desde: clave(inicio), hasta: clave(hoy) });
    }

    await this.generar();
  }

  async cambiarAgrupacion(valor: Agrupacion): Promise<void> {
    if (this.agrupacion() === valor) return;
    this.agrupacion.set(valor);
    await this.cargarVistas();
  }

  exportarExcel(): void {
    if (this.filas().length === 0) {
      this.avisos.info('No hay datos para exportar en este período');
      return;
    }

    try {
      this.reportes.exportarExcel(this.filas());
      this.avisos.exito('Planilla de Excel descargada');
    } catch (error) {
      this.avisos.error(error instanceof Error ? error.message : 'No se pudo exportar a Excel');
    }
  }

  exportarPdf(): void {
    if (this.filas().length === 0) {
      this.avisos.info('No hay datos para exportar en este período');
      return;
    }

    const periodo = this.rango();

    try {
      this.reportes.exportarPdf(this.filas(), periodo.desde, periodo.hasta);
      this.avisos.exito('Reporte en PDF descargado');
    } catch (error) {
      this.avisos.error(error instanceof Error ? error.message : 'No se pudo exportar a PDF');
    }
  }

  miles(valor: number): string {
    return Number(valor ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
  }

  fechaCorta(iso: string): string {
    const partes = (iso ?? '').slice(0, 10).split('-');
    if (partes.length !== 3) return iso ?? '';
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  }

  fechaDia(iso: string): string {
    const fecha = aFecha(iso);
    if (Number.isNaN(fecha.getTime())) return iso ?? '';
    const nombre = fecha.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '');
    return `${nombre} ${this.fechaCorta(iso)}`;
  }

  resaltar(indice: number): void {
    this.barraActiva.set(indice);
  }

  soltar(): void {
    this.barraActiva.set(-1);
  }

  private async cargarVistas(): Promise<void> {
    this.cargandoVistas.set(true);

    const agrupacion = this.agrupacion();

    try {
      const vistas = await this.reportes.masVistas(agrupacion);
      if (agrupacion !== this.agrupacion()) return;
      this.agrupacionCargada.set(agrupacion);
      this.vistas.set(vistas);
    } catch (error) {
      this.avisos.error(
        error instanceof Error ? error.message : 'No se pudieron cargar las películas más vistas',
      );
    } finally {
      if (agrupacion === this.agrupacion()) {
        this.cargandoVistas.set(false);
      }
    }
  }

  private async cargarProductos(): Promise<void> {
    this.cargandoProductos.set(true);

    try {
      this.productos.set(await this.reportes.topProductos(10));
    } catch (error) {
      this.avisos.error(
        error instanceof Error ? error.message : 'No se pudo cargar el ranking del candy bar',
      );
    } finally {
      this.cargandoProductos.set(false);
    }
  }

  private fechaLarga(iso: string): string {
    const fecha = aFecha(iso);
    if (Number.isNaN(fecha.getTime())) return iso ?? '';
    const texto = fecha.toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`;
  }

  private inicioDePeriodo(periodo: string, agrupacion: Agrupacion): Date | null {
    const texto = (periodo ?? '').trim();

    const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(texto);
    if (iso) {
      return this.fechaValida(Number(iso[1]), Number(iso[2]), iso[3] ? Number(iso[3]) : 1);
    }

    const mesAnio = /^(\d{1,2})\/(\d{4})$/.exec(texto);
    if (mesAnio) {
      return this.fechaValida(Number(mesAnio[2]), Number(mesAnio[1]), 1);
    }

    const diaMes = /^(\d{1,2})\/(\d{1,2})$/.exec(texto);
    if (diaMes && agrupacion === 'semana') {
      const hoy = new Date();
      const dia = Number(diaMes[1]);
      const mes = Number(diaMes[2]);
      const esteAnio = this.fechaValida(hoy.getFullYear(), mes, dia);
      if (!esteAnio) return null;
      const limite = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 7);
      return esteAnio.getTime() > limite.getTime()
        ? this.fechaValida(hoy.getFullYear() - 1, mes, dia)
        : esteAnio;
    }

    return null;
  }

  private tituloPeriodo(periodo: string, inicio: Date | null, agrupacion: Agrupacion): string {
    const texto = (periodo ?? '').trim();
    if (!inicio) return texto || 'Período';

    const mes = MESES[inicio.getMonth()];
    const anio = inicio.getFullYear();

    if (agrupacion === 'mes') {
      return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${anio}`;
    }

    const sufijo = anio === new Date().getFullYear() ? '' : ` de ${anio}`;
    return `Semana del ${inicio.getDate()} de ${mes}${sufijo}`;
  }

  private fechaValida(anio: number, mes: number, dia: number): Date | null {
    if (!Number.isInteger(anio) || mes < 1 || mes > 12 || dia < 1) return null;
    const fecha = new Date(anio, mes - 1, dia);
    return fecha.getMonth() === mes - 1 && fecha.getDate() === dia ? fecha : null;
  }
}
