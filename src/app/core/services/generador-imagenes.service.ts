import { Injectable } from '@angular/core';

type Rgb = readonly [number, number, number];
type Azar = () => number;

interface Tonos {
  acento: Rgb;
  fondo: Rgb;
  tinte: Rgb;
}

interface Lienzo {
  lienzo: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

interface Circulos {
  cantidad: number;
  radio: readonly [number, number];
  x: readonly [number, number];
  y: readonly [number, number];
  grosor: number;
  opacidad: readonly [number, number];
}

interface Bloque {
  tamanio: number;
  lineas: string[];
}

interface Rotulo {
  peso: number;
  maximo: number;
  minimo: number;
  ancho: number;
  lineas: number;
}

const FUENTE = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const TIPO = 'image/jpeg';
const CALIDAD = 0.88;
const BLANCO: Rgb = [255, 255, 255];
const FONDO_APP: Rgb = [10, 11, 16];
const ETIQUETA_COMBO = 'Combo';
const ETIQUETA_SIN_CATEGORIA = 'Candy bar';

const PALETA: readonly Tonos[] = [
  { acento: [255, 207, 95], fondo: [27, 21, 10], tinte: [118, 81, 15] },
  { acento: [133, 222, 247], fondo: [13, 19, 25], tinte: [28, 78, 98] },
  { acento: [185, 233, 142], fondo: [18, 21, 16], tinte: [56, 85, 45] },
  { acento: [245, 205, 139], fondo: [19, 15, 12], tinte: [82, 58, 27] },
  { acento: [120, 214, 254], fondo: [12, 18, 34], tinte: [24, 88, 104] },
  { acento: [255, 178, 96], fondo: [20, 15, 11], tinte: [90, 52, 20] },
  { acento: [255, 187, 160], fondo: [25, 15, 23], tinte: [106, 40, 56] },
  { acento: [179, 176, 254], fondo: [16, 16, 23], tinte: [60, 55, 102] },
  { acento: [92, 221, 190], fondo: [10, 16, 19], tinte: [17, 56, 54] },
  { acento: [254, 115, 105], fondo: [20, 10, 11], tinte: [84, 18, 22] },
  { acento: [232, 160, 254], fondo: [22, 13, 25], tinte: [94, 32, 105] },
  { acento: [159, 214, 174], fondo: [15, 18, 16], tinte: [51, 75, 59] },
  { acento: [170, 175, 255], fondo: [12, 15, 26], tinte: [46, 35, 113] },
];

const CANDY: Readonly<Record<string, Tonos>> = {
  pochoclo: { acento: [251, 211, 137], fondo: [38, 27, 9], tinte: [218, 140, 21] },
  bebida: { acento: [145, 215, 241], fondo: [7, 24, 34], tinte: [33, 131, 174] },
  golosina: { acento: [241, 162, 214], fondo: [32, 9, 25], tinte: [184, 50, 147] },
  salado: { acento: [247, 193, 123], fondo: [34, 20, 7], tinte: [218, 119, 19] },
  helado: { acento: [173, 203, 249], fondo: [14, 22, 33], tinte: [73, 125, 199] },
  combo: { acento: [250, 219, 143], fondo: [29, 20, 3], tinte: [201, 146, 28] },
};

const CANDY_ALTERNATIVOS: readonly Tonos[] = [
  CANDY['pochoclo'],
  CANDY['bebida'],
  CANDY['golosina'],
  CANDY['salado'],
  CANDY['helado'],
];

@Injectable({ providedIn: 'root' })
export class GeneradorImagenesService {
  async poster(titulo: string, genero: string | null = null): Promise<Blob> {
    const ancho = 500;
    const alto = 750;
    const semilla = hash(titulo);
    const tonos = PALETA[semilla % PALETA.length];
    const { lienzo, ctx } = await this.crear(ancho, alto);

    pintarDiagonal(ctx, ancho, alto, tonos.fondo, tonos.tinte);
    pintarBrillo(ctx, 355, 212, 104, 0.27, tonos.acento);

    const corte = ctx.createLinearGradient(0, alto - ancho, 0, 480);
    corte.addColorStop(0, rgba(tonos.fondo, 0.56));
    corte.addColorStop(1, rgba(tonos.fondo, 1));
    pintarTriangulo(ctx, [ancho, alto - ancho], [ancho, alto], [0, alto], corte);

    pintarCirculos(ctx, azar(semilla), tonos.acento, {
      cantidad: 6,
      radio: [100, 230],
      x: [0, ancho],
      y: [0, alto],
      grosor: 1.5,
      opacidad: [0.035, 0.09],
    });

    const etiqueta = (genero ?? '').trim();
    if (etiqueta) {
      ctx.font = fuente(400, 17);
      ctx.fillStyle = rgba(tonos.acento);
      ctx.textAlign = 'left';
      ctx.fillText(recortar(ctx, mayusculas(etiqueta), 410), 42, 75);
      ctx.fillRect(42, 85, 80, 3);
    }

    const bloque = ajustar(ctx, titulo, {
      peso: 700,
      maximo: 82,
      minimo: 34,
      ancho: 410,
      lineas: 4,
    });
    ctx.fillStyle = rgba(BLANCO);
    ctx.textAlign = 'left';
    bloque.lineas.forEach((linea, indice) => {
      const desdeAbajo = bloque.lineas.length - 1 - indice;
      ctx.fillText(linea, 42, 678 - desdeAbajo * bloque.tamanio);
    });

    ctx.fillStyle = rgba(tonos.acento);
    ctx.fillRect(0, alto - 10, ancho, 10);

    return exportar(lienzo);
  }

  async banner(titulo: string): Promise<Blob> {
    const ancho = 1920;
    const alto = 820;
    const semilla = hash(titulo);
    const tonos = PALETA[semilla % PALETA.length];
    const { lienzo, ctx } = await this.crear(ancho, alto);

    const fondo = ctx.createLinearGradient(0, 0, ancho, 0);
    fondo.addColorStop(0, rgba(tonos.fondo));
    fondo.addColorStop(1, rgba(mezclar(tonos.fondo, tonos.tinte, 0.74)));
    ctx.fillStyle = fondo;
    ctx.fillRect(0, 0, ancho, alto);

    pintarBrillo(ctx, 1430, 263, 253, 0.38, tonos.acento);

    pintarCirculos(ctx, azar(semilla), tonos.acento, {
      cantidad: 7,
      radio: [205, 575],
      x: [ancho * 0.35, ancho],
      y: [-80, alto * 0.7],
      grosor: 2,
      opacidad: [0.06, 0.16],
    });

    const velo = ctx.createLinearGradient(0, 0, ancho, 0);
    for (let paso = 0; paso <= 10; paso++) {
      const avance = paso / 10;
      velo.addColorStop(avance, rgba(FONDO_APP, Math.pow(1 - avance, 0.82)));
    }
    ctx.fillStyle = velo;
    ctx.fillRect(0, 0, ancho, alto);

    return exportar(lienzo);
  }

  async producto(nombre: string, categoria: string | null = null): Promise<Blob> {
    const etiqueta = (categoria ?? '').trim();
    return this.candy(
      600,
      nombre,
      etiqueta || ETIQUETA_SIN_CATEGORIA,
      tonosDeCategoria(etiqueta, nombre),
    );
  }

  async combo(nombre: string): Promise<Blob> {
    return this.candy(900, nombre, ETIQUETA_COMBO, CANDY['combo']);
  }

  comoArchivo(imagen: Blob, nombre: string): File {
    return new File([imagen], `${nombre}.jpg`, { type: TIPO });
  }

  private async candy(
    ancho: number,
    nombre: string,
    etiqueta: string,
    tonos: Tonos,
  ): Promise<Blob> {
    const alto = 600;
    const { lienzo, ctx } = await this.crear(ancho, alto);

    pintarDiagonal(ctx, ancho, alto, tonos.fondo, tonos.tinte);
    pintarTriangulo(ctx, [ancho, 0], [ancho, alto], [ancho - alto, alto], rgba(tonos.fondo));

    pintarCirculos(ctx, azar(hash(nombre)), tonos.acento, {
      cantidad: 5,
      radio: [130, 260],
      x: [0, ancho],
      y: [0, alto],
      grosor: 1.5,
      opacidad: [0.07, 0.17],
    });

    const anchoTexto = ancho * 0.8;

    ctx.font = fuente(400, 26.5);
    ctx.fillStyle = rgba(tonos.acento);
    ctx.textAlign = 'center';
    ctx.fillText(recortar(ctx, mayusculas(etiqueta), anchoTexto), ancho / 2, 81);

    const bloque = ajustar(ctx, nombre, {
      peso: 700,
      maximo: 72,
      minimo: 30,
      ancho: anchoTexto,
      lineas: 3,
    });
    const interlineado = Math.round(bloque.tamanio * 1.04);
    ctx.fillStyle = rgba(BLANCO);
    bloque.lineas.forEach((linea, indice) => {
      const base = alto / 2 + (indice + 1 - bloque.lineas.length / 2) * interlineado;
      ctx.fillText(linea, ancho / 2, base);
    });

    return exportar(lienzo);
  }

  private async crear(ancho: number, alto: number): Promise<Lienzo> {
    await document.fonts.ready;

    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;

    const ctx = lienzo.getContext('2d');
    if (!ctx) {
      throw new Error('Este navegador no permite generar imágenes.');
    }

    ctx.textBaseline = 'alphabetic';
    return { lienzo, ctx };
  }
}

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function hash(texto: string): number {
  let valor = 0x811c9dc5;
  for (const caracter of normalizar(texto)) {
    valor ^= caracter.codePointAt(0) ?? 0;
    valor = Math.imul(valor, 0x01000193);
  }
  return valor >>> 0;
}

function azar(semilla: number): Azar {
  let estado = semilla || 0x2545f491;
  return () => {
    estado = (estado + 0x6d2b79f5) | 0;
    let mezcla = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    mezcla = (mezcla + Math.imul(mezcla ^ (mezcla >>> 7), 61 | mezcla)) ^ mezcla;
    return ((mezcla ^ (mezcla >>> 14)) >>> 0) / 4294967296;
  };
}

function entre(siguiente: Azar, [minimo, maximo]: readonly [number, number]): number {
  return minimo + siguiente() * (maximo - minimo);
}

function tonosDeCategoria(categoria: string, nombre: string): Tonos {
  const clave = normalizar(categoria).replace(/s$/, '');
  const conocidos = CANDY[clave];
  if (conocidos && clave !== 'combo') {
    return conocidos;
  }
  return CANDY_ALTERNATIVOS[hash(categoria || nombre) % CANDY_ALTERNATIVOS.length];
}

function rgba([rojo, verde, azul]: Rgb, alfa = 1): string {
  return `rgba(${rojo}, ${verde}, ${azul}, ${alfa})`;
}

function mezclar(desde: Rgb, hasta: Rgb, avance: number): Rgb {
  return [
    Math.round(desde[0] + (hasta[0] - desde[0]) * avance),
    Math.round(desde[1] + (hasta[1] - desde[1]) * avance),
    Math.round(desde[2] + (hasta[2] - desde[2]) * avance),
  ];
}

function fuente(peso: number, tamanio: number): string {
  return `${peso} ${tamanio}px ${FUENTE}`;
}

function mayusculas(texto: string): string {
  return texto.toLocaleUpperCase('es-AR');
}

function pintarDiagonal(
  ctx: CanvasRenderingContext2D,
  ancho: number,
  alto: number,
  desde: Rgb,
  hasta: Rgb,
): void {
  const largo = (ancho + alto) / 2;
  const degrade = ctx.createLinearGradient(0, 0, largo, largo);
  degrade.addColorStop(0, rgba(desde));
  degrade.addColorStop(1, rgba(hasta));
  ctx.fillStyle = degrade;
  ctx.fillRect(0, 0, ancho, alto);
}

function pintarBrillo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dispersion: number,
  intensidad: number,
  color: Rgb,
): void {
  const radio = dispersion * 3;
  const brillo = ctx.createRadialGradient(x, y, 0, x, y, radio);
  for (let paso = 0; paso <= 12; paso++) {
    const distancia = (paso / 12) * 3;
    const alfa = paso === 12 ? 0 : intensidad * Math.exp(-(distancia * distancia) / 2);
    brillo.addColorStop(paso / 12, rgba(color, alfa));
  }
  ctx.fillStyle = brillo;
  ctx.fillRect(x - radio, y - radio, radio * 2, radio * 2);
}

function pintarTriangulo(
  ctx: CanvasRenderingContext2D,
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  relleno: string | CanvasGradient,
): void {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.lineTo(c[0], c[1]);
  ctx.closePath();
  ctx.fillStyle = relleno;
  ctx.fill();
}

function pintarCirculos(
  ctx: CanvasRenderingContext2D,
  siguiente: Azar,
  color: Rgb,
  circulos: Circulos,
): void {
  ctx.lineWidth = circulos.grosor;
  for (let indice = 0; indice < circulos.cantidad; indice++) {
    const x = entre(siguiente, circulos.x);
    const y = entre(siguiente, circulos.y);
    const radio = entre(siguiente, circulos.radio);
    ctx.strokeStyle = rgba(color, entre(siguiente, circulos.opacidad));
    ctx.beginPath();
    ctx.arc(x, y, radio, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function partir(ctx: CanvasRenderingContext2D, palabras: string[], ancho: number): string[] {
  const lineas: string[] = [];
  let actual = '';

  for (const palabra of palabras) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (!actual || ctx.measureText(candidata).width <= ancho) {
      actual = candidata;
    } else {
      lineas.push(actual);
      actual = palabra;
    }
  }

  if (actual) {
    lineas.push(actual);
  }
  return lineas;
}

function recortar(ctx: CanvasRenderingContext2D, texto: string, ancho: number): string {
  if (ctx.measureText(texto).width <= ancho) {
    return texto;
  }

  let corto = texto;
  while (corto.length > 1 && ctx.measureText(`${corto}…`).width > ancho) {
    corto = corto.slice(0, -1).trimEnd();
  }
  return `${corto}…`;
}

function ajustar(ctx: CanvasRenderingContext2D, texto: string, rotulo: Rotulo): Bloque {
  const palabras = texto.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) {
    return { tamanio: rotulo.maximo, lineas: [] };
  }

  for (let tamanio = rotulo.maximo; tamanio >= rotulo.minimo; tamanio--) {
    ctx.font = fuente(rotulo.peso, tamanio);
    const lineas = partir(ctx, palabras, rotulo.ancho);
    const entran = lineas.every((linea) => ctx.measureText(linea).width <= rotulo.ancho);
    if (lineas.length <= rotulo.lineas && entran) {
      return { tamanio, lineas };
    }
  }

  ctx.font = fuente(rotulo.peso, rotulo.minimo);
  const todas = partir(ctx, palabras, rotulo.ancho);
  const visibles = todas.slice(0, rotulo.lineas);
  if (todas.length > rotulo.lineas) {
    visibles[visibles.length - 1] = todas.slice(rotulo.lineas - 1).join(' ');
  }

  return {
    tamanio: rotulo.minimo,
    lineas: visibles.map((linea) => recortar(ctx, linea, rotulo.ancho)),
  };
}

function exportar(lienzo: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolver, rechazar) => {
    lienzo.toBlob(
      (imagen) =>
        imagen ? resolver(imagen) : rechazar(new Error('No se pudo generar la imagen.')),
      TIPO,
      CALIDAD,
    );
  });
}
