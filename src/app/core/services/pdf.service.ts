import { Injectable } from '@angular/core';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { ResumenCompra } from '../models/modelos';
import { textoMedioPago } from '../../shared/pipes/medio-pago.pipe';
import { ZONA_HORARIA } from '../../shared/utils/ventas';
import {
  avisoCompraMenor,
  avisoRestriccion,
  etiquetaRestriccion,
} from '../../shared/utils/restriccion';

const AMBAR: [number, number, number] = [201, 138, 28];
const TINTA: [number, number, number] = [22, 22, 26];
const SUAVE: [number, number, number] = [120, 120, 132];
const ROJO: [number, number, number] = [196, 42, 40];
const VERDE: [number, number, number] = [30, 140, 92];
const LADO_QR = 55;
const SUFIJO_CANJE = /\s*\(canje\)$/i;
const INICIO_PAGINA = 44;
const FONDO_ROJO: [number, number, number] = [253, 236, 236];
const LINEA_AVISO = 3.9;

@Injectable({ providedIn: 'root' })
export class PdfService {
  async qr(texto: string): Promise<string> {
    try {
      return await QRCode.toDataURL(texto, { width: 400, margin: 1 });
    } catch {
      throw new Error('No se pudo generar el código QR de la entrada');
    }
  }

  async generarEntrada(resumen: ResumenCompra): Promise<void> {
    const compra = resumen.compra;
    if (!compra?.codigo) throw new Error('La compra no tiene un código válido');
    if (compra.estado === 'cancelada') {
      throw new Error('La compra fue cancelada: la entrada ya no es válida');
    }

    const imagenQr = await this.qr(compra.codigo);

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const ancho = doc.internal.pageSize.getWidth();
    const alto = doc.internal.pageSize.getHeight();
    const margen = 16;
    const util = ancho - margen * 2;

    this.fondo(doc, ancho, alto);
    this.marca(doc, ancho, margen);

    let y = INICIO_PAGINA;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    this.tinta(doc, TINTA);
    const titulo: string[] = doc.splitTextToSize(
      resumen.pelicula?.titulo ?? 'Función de cine',
      util,
    );
    doc.text(titulo, margen, y);
    y += titulo.length * 9 + 1;

    const restriccion = resumen.pelicula?.restriccion_edad ?? 0;
    const etiquetas: string[] = [];
    if (resumen.funcion?.formato) etiquetas.push(resumen.funcion.formato);
    if (resumen.funcion?.idioma) {
      etiquetas.push(resumen.funcion.idioma === 'castellano' ? 'Castellano' : 'Subtitulada');
    }
    etiquetas.push(etiquetaRestriccion(restriccion));
    if (compra.requiere_adulto) etiquetas.push('MENOR');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    this.tinta(doc, SUAVE);
    doc.text(etiquetas.join('   ·   '), margen, y);
    y += 10;

    y = this.bloqueFuncion(doc, resumen, margen, util, y);
    y = this.bloqueButacas(doc, resumen, ancho, margen, y);
    y = this.bloqueProductos(doc, resumen, ancho, alto, margen, y);
    y = this.bloqueTotales(doc, resumen, ancho, alto, margen, y);

    if (y > alto - 118) {
      y = this.paginaNueva(doc, ancho, alto, margen);
    }

    const yBloque = Math.max(y + 4, alto - 112);
    const xQr = ancho - margen - LADO_QR;
    const anchoIzquierda = util - LADO_QR - 10;

    doc.addImage(imagenQr, 'PNG', xQr, yBloque, LADO_QR, LADO_QR);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    this.tinta(doc, SUAVE);
    doc.text('CÓDIGO DE COMPRA', margen, yBloque + 9);

    doc.setFont('courier', 'bold');
    doc.setFontSize(21);
    this.tinta(doc, TINTA);
    doc.text(compra.codigo, margen, yBloque + 21);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    this.tinta(doc, SUAVE);
    doc.text(
      `Emitida el ${this.fechaHora(compra.creado_en)}`,
      margen,
      yBloque + 29,
    );

    let yAviso = yBloque + 35;

    if (restriccion > 0) {
      yAviso = this.recuadroAviso(
        doc,
        null,
        avisoRestriccion(restriccion),
        margen,
        yAviso,
        anchoIzquierda,
      );
    }

    if (compra.requiere_adulto) {
      this.recuadroAviso(
        doc,
        'MENOR',
        `${avisoCompraMenor(true, compra.adulto_codigo)}.`,
        margen,
        yAviso,
        anchoIzquierda,
      );
    }

    this.pie(doc, ancho, alto, margen, util);

    doc.save(`entrada-${compra.codigo}.pdf`);
  }

  private recuadroAviso(
    doc: jsPDF,
    titulo: string | null,
    texto: string,
    x: number,
    y: number,
    ancho: number,
  ): number {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const lineas: string[] = doc.splitTextToSize(texto, ancho - 10);
    const altoTitulo = titulo ? 5.5 : 0;
    const alto = altoTitulo + lineas.length * LINEA_AVISO + 7;

    doc.setFillColor(FONDO_ROJO[0], FONDO_ROJO[1], FONDO_ROJO[2]);
    doc.setDrawColor(ROJO[0], ROJO[1], ROJO[2]);
    doc.setLineWidth(0.5);
    doc.roundedRect(x, y, ancho, alto, 2.5, 2.5, 'FD');

    if (titulo) {
      doc.setFontSize(10);
      this.tinta(doc, ROJO);
      doc.text(titulo, x + 5, y + 6.5);
      doc.setFontSize(9);
    }

    this.tinta(doc, ROJO);
    doc.text(lineas, x + 5, y + 6.5 + altoTitulo);

    return y + alto + 3;
  }

  private paginaNueva(doc: jsPDF, ancho: number, alto: number, margen: number): number {
    doc.addPage();
    this.fondo(doc, ancho, alto);
    this.marca(doc, ancho, margen);
    return INICIO_PAGINA;
  }

  private salto(
    doc: jsPDF,
    y: number,
    ancho: number,
    alto: number,
    margen: number,
    necesario = 10,
  ): number {
    if (y + necesario <= alto - 34) return y;
    return this.paginaNueva(doc, ancho, alto, margen);
  }

  private fondo(doc: jsPDF, ancho: number, alto: number): void {
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, ancho, alto, 'F');
  }

  private marca(doc: jsPDF, ancho: number, margen: number): void {
    doc.setFillColor(AMBAR[0], AMBAR[1], AMBAR[2]);
    doc.rect(0, 0, ancho, 6, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(26);
    this.tinta(doc, AMBAR);
    doc.text('CineNova', margen, 26);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    this.tinta(doc, SUAVE);
    doc.text('Entrada digital', ancho - margen, 26, { align: 'right' });

    doc.setDrawColor(236, 222, 196);
    doc.setLineWidth(0.7);
    doc.line(margen, 31, ancho - margen, 31);
  }

  private bloqueFuncion(
    doc: jsPDF,
    resumen: ResumenCompra,
    margen: number,
    util: number,
    y: number,
  ): number {
    doc.setFillColor(248, 248, 251);
    doc.setDrawColor(228, 230, 238);
    doc.setLineWidth(0.4);
    doc.roundedRect(margen, y, util, 26, 3, 3, 'FD');

    const celdas = [
      { titulo: 'FECHA', valor: this.fecha(resumen.funcion?.inicio) },
      { titulo: 'HORA', valor: this.hora(resumen.funcion?.inicio) },
      { titulo: 'SALA', valor: resumen.sala ?? resumen.funcion?.sala?.nombre ?? 'A confirmar' },
    ];

    const anchoCelda = util / celdas.length;

    celdas.forEach((celda, indice) => {
      const x = margen + 8 + anchoCelda * indice;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      this.tinta(doc, SUAVE);
      doc.text(celda.titulo, x, y + 9.5);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      this.tinta(doc, TINTA);
      doc.text(celda.valor, x, y + 18);
    });

    return y + 38;
  }

  private bloqueButacas(
    doc: jsPDF,
    resumen: ResumenCompra,
    ancho: number,
    margen: number,
    y: number,
  ): number {
    let cursor = this.titulo(doc, 'Butacas', margen, y);

    const butacas = resumen.butacas ?? [];

    if (butacas.length === 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      this.tinta(doc, SUAVE);
      doc.text('Sin butacas asociadas a esta compra.', margen, cursor + 4);
      return cursor + 14;
    }

    const altoChip = 9.5;
    let x = margen;

    for (const butaca of butacas) {
      const texto =
        butaca.tipo === 'vip'
          ? `${butaca.etiqueta}  VIP`
          : butaca.tipo === 'accesible'
            ? `${butaca.etiqueta}  Accesible`
            : butaca.etiqueta;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      const anchoChip = doc.getTextWidth(texto) + 11;

      if (x + anchoChip > ancho - margen) {
        x = margen;
        cursor += altoChip + 4;
      }

      if (butaca.tipo === 'vip') {
        doc.setFillColor(253, 246, 224);
        doc.setDrawColor(203, 166, 48);
        this.tinta(doc, [138, 102, 10]);
      } else if (butaca.tipo === 'accesible') {
        doc.setFillColor(234, 246, 252);
        doc.setDrawColor(96, 176, 210);
        this.tinta(doc, [25, 100, 130]);
      } else {
        doc.setFillColor(245, 245, 249);
        doc.setDrawColor(216, 218, 226);
        this.tinta(doc, [45, 45, 54]);
      }

      doc.setLineWidth(0.4);
      doc.roundedRect(x, cursor, anchoChip, altoChip, 2.5, 2.5, 'FD');
      doc.text(texto, x + 5.5, cursor + 6.5);

      x += anchoChip + 4;
    }

    return cursor + altoChip + 12;
  }

  private bloqueProductos(
    doc: jsPDF,
    resumen: ResumenCompra,
    ancho: number,
    alto: number,
    margen: number,
    y: number,
  ): number {
    const items = resumen.items ?? [];
    if (items.length === 0) return y;

    const inicio = this.salto(doc, y, ancho, alto, margen, 20);
    let cursor = this.titulo(doc, 'Candy bar', margen, inicio) + 3;

    for (const item of items) {
      cursor = this.salto(doc, cursor, ancho, alto, margen);
      const canje = Number(item.precio_unitario) === 0 && SUFIJO_CANJE.test(item.nombre);
      const nombre = canje ? item.nombre.replace(SUFIJO_CANJE, '') : item.nombre;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      this.tinta(doc, [55, 55, 64]);
      doc.text(`${item.cantidad} x ${nombre}`, margen, cursor);

      if (canje) {
        doc.setFont('helvetica', 'bold');
        this.tinta(doc, VERDE);
        doc.text('Canje', ancho - margen, cursor, { align: 'right' });
      } else {
        doc.text(
          this.moneda(item.cantidad * item.precio_unitario),
          ancho - margen,
          cursor,
          { align: 'right' },
        );
      }
      cursor += 6.8;
    }

    return cursor + 6;
  }

  private bloqueTotales(
    doc: jsPDF,
    resumen: ResumenCompra,
    ancho: number,
    alto: number,
    margen: number,
    y: number,
  ): number {
    const compra = resumen.compra;
    const descuentoCombos = Number(compra.descuento_combos ?? 0);

    const lineas: { etiqueta: string; valor: string }[] = [
      { etiqueta: 'Subtotal', valor: this.moneda(compra.subtotal) },
    ];
    if (compra.descuento_canjes > 0) {
      lineas.push({ etiqueta: 'Canje de puntos', valor: `- ${this.moneda(compra.descuento_canjes)}` });
    }
    if (descuentoCombos > 0) {
      lineas.push({
        etiqueta: 'Entradas incluidas en combos',
        valor: `- ${this.moneda(descuentoCombos)}`,
      });
    }
    if (compra.descuento > 0) {
      lineas.push({ etiqueta: 'Descuento', valor: `- ${this.moneda(compra.descuento)}` });
    }
    if (compra.credito_usado > 0) {
      lineas.push({ etiqueta: 'Crédito usado', valor: `- ${this.moneda(compra.credito_usado)}` });
    }

    let cursor = this.salto(doc, y, ancho, alto, margen, 40 + lineas.length * 6.4);

    doc.setDrawColor(228, 230, 238);
    doc.setLineWidth(0.4);
    doc.line(margen, cursor, ancho - margen, cursor);
    cursor += 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    this.tinta(doc, SUAVE);

    for (const linea of lineas) {
      doc.text(linea.etiqueta, margen, cursor);
      doc.text(linea.valor, ancho - margen, cursor, { align: 'right' });
      cursor += 6.4;
    }

    cursor += 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    this.tinta(doc, TINTA);
    doc.text('Total', margen, cursor);
    this.tinta(doc, AMBAR);
    doc.text(this.moneda(compra.total), ancho - margen, cursor, { align: 'right' });
    cursor += 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    this.tinta(doc, SUAVE);
    doc.text(`Medio de pago: ${textoMedioPago(compra)}`, margen, cursor);
    cursor += 6.4;

    if (compra.puntos_ganados > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      this.tinta(doc, SUAVE);
      doc.text(`Sumaste ${compra.puntos_ganados} puntos con esta compra.`, margen, cursor);
      cursor += 7;
    }

    return cursor + 4;
  }

  private pie(doc: jsPDF, ancho: number, alto: number, margen: number, util: number): void {
    const y = alto - 28;

    doc.setDrawColor(232, 234, 240);
    doc.setLineWidth(0.4);
    doc.line(margen, y, ancho - margen, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    this.tinta(doc, SUAVE);

    const texto: string[] = doc.splitTextToSize(
      'Mostrá este código QR para ingresar a la sala y para retirar tu pedido en el candy bar. Cada uno se valida una sola vez y la entrada sirve solo el día de la función.',
      util,
    );
    doc.text(texto, margen, y + 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    this.tinta(doc, AMBAR);
    doc.text('CineNova', margen, alto - 10);
  }

  private titulo(doc: jsPDF, texto: string, margen: number, y: number): number {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    this.tinta(doc, AMBAR);
    doc.text(texto.toUpperCase(), margen, y);
    return y + 6;
  }

  private tinta(doc: jsPDF, color: [number, number, number]): void {
    doc.setTextColor(color[0], color[1], color[2]);
  }

  private fecha(iso: string | undefined): string {
    if (!iso) return 'A confirmar';
    const valor = new Date(iso);
    if (Number.isNaN(valor.getTime())) return 'A confirmar';
    return valor.toLocaleDateString('es-AR', {
      timeZone: ZONA_HORARIA,
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  private hora(iso: string | undefined): string {
    if (!iso) return '--:--';
    const valor = new Date(iso);
    if (Number.isNaN(valor.getTime())) return '--:--';
    return valor.toLocaleTimeString('es-AR', {
      timeZone: ZONA_HORARIA,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }

  private fechaHora(iso: string | undefined): string {
    if (!iso) return '-';
    const valor = new Date(iso);
    if (Number.isNaN(valor.getTime())) return '-';
    return valor.toLocaleString('es-AR', {
      timeZone: ZONA_HORARIA,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }

  private moneda(valor: number): string {
    return `$ ${Number(valor ?? 0).toLocaleString('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
  }
}
