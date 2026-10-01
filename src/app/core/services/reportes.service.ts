import { Injectable, inject } from '@angular/core';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { SupabaseService } from './supabase.service';
import {
  EstadisticasAdmin,
  FilaFacturacion,
  LogActividad,
  Perfil,
  PeliculaVista,
  RolUsuario,
  TopProducto,
} from '../models/modelos';

const ENCABEZADOS = ['Día', 'Compras', 'Entradas', 'Productos', 'Facturado'];

@Injectable({ providedIn: 'root' })
export class ReportesService {
  private readonly sb = inject(SupabaseService);

  async estadisticas(): Promise<EstadisticasAdmin> {
    const { data, error } = await this.sb.client.rpc('estadisticas_admin');

    if (error) throw new Error(error.message || 'No se pudieron cargar las estadísticas');

    const fila = Array.isArray(data) ? data[0] : data;

    return {
      facturado_hoy: Number((fila as EstadisticasAdmin | null)?.facturado_hoy ?? 0),
      entradas_hoy: Number((fila as EstadisticasAdmin | null)?.entradas_hoy ?? 0),
      facturado_mes: Number((fila as EstadisticasAdmin | null)?.facturado_mes ?? 0),
      usuarios: Number((fila as EstadisticasAdmin | null)?.usuarios ?? 0),
      peliculas: Number((fila as EstadisticasAdmin | null)?.peliculas ?? 0),
      funciones_hoy: Number((fila as EstadisticasAdmin | null)?.funciones_hoy ?? 0),
    };
  }

  async facturacion(desde: string, hasta: string): Promise<FilaFacturacion[]> {
    const { data, error } = await this.sb.client.rpc('reporte_facturacion', {
      p_desde: desde,
      p_hasta: hasta,
    });

    if (error) throw new Error(error.message || 'No se pudo generar el reporte de facturación');

    return ((data ?? []) as FilaFacturacion[]).map((fila) => ({
      dia: String(fila.dia ?? ''),
      compras: Number(fila.compras ?? 0),
      entradas: Number(fila.entradas ?? 0),
      productos: Number(fila.productos ?? 0),
      facturado: Number(fila.facturado ?? 0),
    }));
  }

  async masVistas(agrupacion: 'semana' | 'mes'): Promise<PeliculaVista[]> {
    const { data, error } = await this.sb.client.rpc('peliculas_mas_vistas', {
      p_agrupacion: agrupacion,
    });

    if (error) throw new Error(error.message || 'No se pudieron cargar las películas más vistas');

    return ((data ?? []) as PeliculaVista[]).map((fila) => ({
      periodo: String(fila.periodo ?? ''),
      titulo: String(fila.titulo ?? ''),
      vistas: Number(fila.vistas ?? 0),
    }));
  }

  async topProductos(limite = 10): Promise<TopProducto[]> {
    const { data, error } = await this.sb.client.rpc('top_productos', { p_limite: limite });

    if (error) throw new Error(error.message || 'No se pudo cargar el ranking de productos');

    return ((data ?? []) as TopProducto[]).map((fila) => ({
      nombre: String(fila.nombre ?? ''),
      unidades: Number(fila.unidades ?? 0),
      facturado: Number(fila.facturado ?? 0),
    }));
  }

  async actividad(limite = 60): Promise<LogActividad[]> {
    const { data, error } = await this.sb.client
      .from('log_actividad')
      .select('*')
      .order('creado_en', { ascending: false })
      .limit(limite);

    if (error) throw new Error('No se pudo cargar el registro de actividad');
    return (data ?? []) as LogActividad[];
  }

  async usuarios(): Promise<Perfil[]> {
    const { data, error } = await this.sb.client
      .from('perfiles')
      .select('*')
      .order('creado_en', { ascending: false });

    if (error) throw new Error('No se pudieron cargar los usuarios');
    return (data ?? []) as Perfil[];
  }

  async cambiarRol(id: string, rol: RolUsuario): Promise<void> {
    const { error } = await this.sb.client.from('perfiles').update({ rol }).eq('id', id);
    if (error) throw new Error('No se pudo cambiar el rol del usuario');
  }

  exportarExcel(filas: FilaFacturacion[]): void {
    const datos = filas.map((fila) => ({
      'Día': this.fechaCorta(fila.dia),
      'Compras': fila.compras,
      'Entradas': fila.entradas,
      'Productos': fila.productos,
      'Facturado': fila.facturado,
    }));

    const hoja = XLSX.utils.json_to_sheet(datos, { header: ENCABEZADOS });
    hoja['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 16 }];

    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Facturación');
    XLSX.writeFile(libro, 'facturacion.xlsx');
  }

  exportarPdf(filas: FilaFacturacion[], desde: string, hasta: string): void {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const ancho = doc.internal.pageSize.getWidth();
    const alto = doc.internal.pageSize.getHeight();
    const margen = 14;
    const util = ancho - margen * 2;

    const columnas = [
      { titulo: 'Día', x: margen, alineacion: 'left' as const },
      { titulo: 'Compras', x: margen + 74, alineacion: 'right' as const },
      { titulo: 'Entradas', x: margen + 106, alineacion: 'right' as const },
      { titulo: 'Productos', x: margen + 140, alineacion: 'right' as const },
      { titulo: 'Facturado', x: margen + util, alineacion: 'right' as const },
    ];

    const totales = filas.reduce(
      (acumulado, fila) => ({
        compras: acumulado.compras + fila.compras,
        entradas: acumulado.entradas + fila.entradas,
        productos: acumulado.productos + fila.productos,
        facturado: acumulado.facturado + fila.facturado,
      }),
      { compras: 0, entradas: 0, productos: 0, facturado: 0 },
    );

    let y = this.encabezadoPdf(doc, ancho, margen, util, desde, hasta);
    y = this.encabezadoTabla(doc, columnas, margen, util, y);

    const altoFila = 7.6;
    let impar = false;

    for (const fila of filas) {
      if (y + altoFila > alto - 34) {
        doc.addPage();
        y = this.encabezadoPdf(doc, ancho, margen, util, desde, hasta);
        y = this.encabezadoTabla(doc, columnas, margen, util, y);
        impar = false;
      }

      if (impar) {
        doc.setFillColor(247, 247, 250);
        doc.rect(margen, y - 5.2, util, altoFila, 'F');
      }
      impar = !impar;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(40, 40, 48);

      const valores = [
        this.fechaCorta(fila.dia),
        this.entero(fila.compras),
        this.entero(fila.entradas),
        this.entero(fila.productos),
        this.moneda(fila.facturado),
      ];

      columnas.forEach((columna, indice) => {
        doc.text(valores[indice] ?? '', columna.x, y, { align: columna.alineacion });
      });

      y += altoFila;
    }

    if (filas.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(10);
      doc.setTextColor(130, 130, 140);
      doc.text('No hubo movimientos en el período seleccionado.', margen, y + 2);
      y += 12;
    }

    y += 2;
    doc.setDrawColor(201, 138, 28);
    doc.setLineWidth(0.6);
    doc.line(margen, y, margen + util, y);
    y += 7;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(20, 20, 26);

    const pie = [
      'Totales',
      this.entero(totales.compras),
      this.entero(totales.entradas),
      this.entero(totales.productos),
      this.moneda(totales.facturado),
    ];

    columnas.forEach((columna, indice) => {
      doc.text(pie[indice] ?? '', columna.x, y, { align: columna.alineacion });
    });

    const paginas = doc.getNumberOfPages();
    for (let pagina = 1; pagina <= paginas; pagina += 1) {
      doc.setPage(pagina);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 158);
      doc.text(`Página ${pagina} de ${paginas}`, margen + util, alto - 10, { align: 'right' });
      doc.text(`Generado el ${this.fechaHoraActual()}`, margen, alto - 10);
    }

    doc.save('facturacion.pdf');
  }

  private encabezadoPdf(
    doc: jsPDF,
    ancho: number,
    margen: number,
    util: number,
    desde: string,
    hasta: string,
  ): number {
    doc.setFillColor(201, 138, 28);
    doc.rect(0, 0, ancho, 5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(201, 138, 28);
    doc.text('CineNova — Reporte de facturación', margen, 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(110, 110, 120);
    doc.text(
      `Período: ${this.fechaCorta(desde)} al ${this.fechaCorta(hasta)}`,
      margen,
      27,
    );

    doc.setDrawColor(228, 230, 236);
    doc.setLineWidth(0.4);
    doc.line(margen, 32, margen + util, 32);

    return 42;
  }

  private encabezadoTabla(
    doc: jsPDF,
    columnas: { titulo: string; x: number; alineacion: 'left' | 'right' }[],
    margen: number,
    util: number,
    y: number,
  ): number {
    doc.setFillColor(235, 237, 243);
    doc.rect(margen, y - 5.6, util, 8.4, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 70);

    for (const columna of columnas) {
      doc.text(columna.titulo, columna.x, y, { align: columna.alineacion });
    }

    return y + 9;
  }

  private fechaCorta(valor: string): string {
    const base = (valor ?? '').slice(0, 10).split('-');
    if (base.length === 3) return `${base[2]}/${base[1]}/${base[0]}`;
    return valor ?? '';
  }

  private fechaHoraActual(): string {
    return new Date().toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private entero(valor: number): string {
    return Number(valor ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
  }

  private moneda(valor: number): string {
    return `$ ${Number(valor ?? 0).toLocaleString('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
  }
}
