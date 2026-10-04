import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  EstadisticasAdmin,
  FilaFacturacion,
  LogActividad,
  TopProducto,
} from '../../core/models/modelos';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { ReportesService } from '../../core/services/reportes.service';
import { VacioComponent } from '../../shared/components/vacio.component';
import { DesdePipe } from '../../shared/pipes/desde.pipe';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { ColorAccion, colorAccion, etiquetaAccion, nombreEntidad } from './actividad';

interface Metrica {
  clave: string;
  etiqueta: string;
  valor: number;
  moneda: boolean;
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
  dia: string;
  monto: number;
}

interface BarraProducto {
  nombre: string;
  unidades: number;
  facturado: number;
  porcentaje: number;
}

interface RegistroVista {
  id: number;
  etiqueta: string;
  entidad: string;
  entidadId: string;
  email: string;
  creado: string;
  color: ColorAccion;
}

interface Acceso {
  ruta: string;
  titulo: string;
  texto: string;
}

const ANCHO = 560;
const MARGEN = 12;
const BASE = 164;
const TOPE = 16;

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, VacioComponent, PrecioPipe, DesdePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private readonly reportes = inject(ReportesService);
  private readonly avisos = inject(NotificacionesService);

  readonly estadisticas = signal<EstadisticasAdmin | null>(null);
  readonly facturacion = signal<FilaFacturacion[]>([]);
  readonly productos = signal<TopProducto[]>([]);
  readonly actividad = signal<LogActividad[]>([]);
  readonly cargando = signal(true);
  readonly barraActiva = signal(-1);

  readonly huecos = [1, 2, 3, 4, 5, 6];
  readonly guias = [TOPE, 53, 90, 127];

  readonly accesos: Acceso[] = [
    { ruta: '/admin/peliculas', titulo: 'Películas', texto: 'Altas, bajas y cartelera' },
    { ruta: '/admin/funciones', titulo: 'Funciones', texto: 'Programación y precios' },
    { ruta: '/admin/salas', titulo: 'Salas', texto: 'Salas y butacas' },
    { ruta: '/admin/candy', titulo: 'Candy bar', texto: 'Productos y combos' },
    { ruta: '/admin/promociones', titulo: 'Promociones', texto: 'Cupones y recompensas' },
    { ruta: '/admin/usuarios', titulo: 'Usuarios', texto: 'Roles y permisos' },
    { ruta: '/admin/reportes', titulo: 'Reportes', texto: 'Facturación y rankings' },
    { ruta: '/admin/log', titulo: 'Actividad', texto: 'Quién hizo cada cosa' },
  ];

  readonly metricas = computed<Metrica[]>(() => {
    const datos = this.estadisticas();
    if (!datos) return [];
    return [
      { clave: 'facturado_hoy', etiqueta: 'Facturado hoy', valor: datos.facturado_hoy, moneda: true },
      { clave: 'entradas_hoy', etiqueta: 'Entradas hoy', valor: datos.entradas_hoy, moneda: false },
      { clave: 'facturado_mes', etiqueta: 'Facturado del mes', valor: datos.facturado_mes, moneda: true },
      { clave: 'usuarios', etiqueta: 'Usuarios registrados', valor: datos.usuarios, moneda: false },
      { clave: 'peliculas', etiqueta: 'Películas en cartelera', valor: datos.peliculas, moneda: false },
      { clave: 'funciones_hoy', etiqueta: 'Funciones de hoy', valor: datos.funciones_hoy, moneda: false },
    ];
  });

  readonly picoFacturacion = computed(() =>
    this.facturacion().reduce((maximo, fila) => Math.max(maximo, fila.facturado), 0),
  );

  readonly totalQuincena = computed(() =>
    this.facturacion().reduce((suma, fila) => suma + fila.facturado, 0),
  );

  readonly barras = computed<BarraDia[]>(() => {
    const filas = this.facturacion();
    if (filas.length === 0) return [];

    const maximo = Math.max(this.picoFacturacion(), 1);
    const util = ANCHO - MARGEN * 2;
    const paso = util / filas.length;
    const ancho = Math.min(30, paso * 0.56);
    const disponible = BASE - TOPE;

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
        dia: this.diaLargo(fila.dia),
        monto: fila.facturado,
      };
    });
  });

  readonly barraSeleccionada = computed<BarraDia | null>(
    () => this.barras()[this.barraActiva()] ?? null,
  );

  readonly ranking = computed<BarraProducto[]>(() => {
    const lista = this.productos();
    const maximo = Math.max(...lista.map((producto) => producto.unidades), 1);
    return lista.map((producto) => ({
      nombre: producto.nombre,
      unidades: producto.unidades,
      facturado: producto.facturado,
      porcentaje: Math.max(6, (producto.unidades / maximo) * 100),
    }));
  });

  readonly registros = computed<RegistroVista[]>(() =>
    this.actividad().map((fila) => ({
      id: fila.id,
      etiqueta: etiquetaAccion(fila.accion),
      entidad: nombreEntidad(fila.entidad),
      entidadId: fila.entidad_id ?? '',
      email: fila.email ?? 'Sistema',
      creado: fila.creado_en,
      color: colorAccion(fila.accion),
    })),
  );

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async recargar(): Promise<void> {
    await this.cargar();
  }

  miles(valor: number): string {
    return Number(valor ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
  }

  resaltar(indice: number): void {
    this.barraActiva.set(indice);
  }

  soltar(): void {
    this.barraActiva.set(-1);
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    const rango = this.ultimosDias(14);

    try {
      const [estadisticas, facturacion, productos, actividad] = await Promise.all([
        this.reportes.estadisticas(),
        this.reportes.facturacion(rango.desde, rango.hasta),
        this.reportes.topProductos(5),
        this.reportes.actividad(8),
      ]);

      this.estadisticas.set(estadisticas);
      this.facturacion.set(this.completar(facturacion, rango.desde, rango.hasta));
      this.productos.set(productos);
      this.actividad.set(actividad);
    } catch (error) {
      this.avisos.error(error instanceof Error ? error.message : 'No se pudo cargar el panel');
    } finally {
      this.cargando.set(false);
    }
  }

  private completar(filas: FilaFacturacion[], desde: string, hasta: string): FilaFacturacion[] {
    const mapa = new Map(filas.map((fila) => [fila.dia.slice(0, 10), fila]));
    const cursor = this.aFecha(desde);
    const fin = this.aFecha(hasta).getTime();
    const resultado: FilaFacturacion[] = [];
    let vueltas = 0;

    while (cursor.getTime() <= fin && vueltas < 60) {
      const clave = this.clave(cursor);
      const encontrada = mapa.get(clave);
      resultado.push(
        encontrada
          ? { ...encontrada, dia: clave }
          : { dia: clave, compras: 0, entradas: 0, productos: 0, facturado: 0 },
      );
      cursor.setDate(cursor.getDate() + 1);
      vueltas += 1;
    }

    return resultado;
  }

  private ultimosDias(dias: number): { desde: string; hasta: string } {
    const hoy = new Date();
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - (dias - 1));
    return { desde: this.clave(inicio), hasta: this.clave(hoy) };
  }

  private clave(fecha: Date): string {
    const mes = `${fecha.getMonth() + 1}`.padStart(2, '0');
    const dia = `${fecha.getDate()}`.padStart(2, '0');
    return `${fecha.getFullYear()}-${mes}-${dia}`;
  }

  private aFecha(iso: string): Date {
    const partes = (iso ?? '').slice(0, 10).split('-');
    return new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
  }

  private diaLargo(iso: string): string {
    const texto = this.aFecha(iso).toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`;
  }
}
