import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { environment } from '../../../environments/environment';

export type CarpetaImagen = 'posters' | 'banners' | 'productos' | 'combos';

export const MAXIMO_MB_IMAGEN = 2;
export const TIPOS_IMAGEN = 'image/jpeg,image/png,image/webp';
export const PREFIJO_AUTOMATICA = 'auto-';

interface ErrorDeAlmacenamiento {
  message?: string;
  status?: number;
  statusCode?: string;
}

const BUCKET = 'imagenes';
const MAXIMO_BYTES = MAXIMO_MB_IMAGEN * 1024 * 1024;
const UN_ANIO_EN_SEGUNDOS = '31536000';
const ESPERAS_REINTENTO_MS: readonly number[] = [700, 1800];
const CARPETAS: readonly CarpetaImagen[] = ['posters', 'banners', 'productos', 'combos'];
const EXTENSIONES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable({ providedIn: 'root' })
export class ImagenesService {
  private readonly supabase = inject(SupabaseService);
  private readonly prefijo = `${environment.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET}/`;

  validar(archivo: File): string | null {
    if (!EXTENSIONES[archivo.type]) {
      return 'Elegí una imagen JPG, PNG o WEBP.';
    }

    if (archivo.size === 0) {
      return 'El archivo está vacío. Elegí otra imagen.';
    }

    if (archivo.size > MAXIMO_BYTES) {
      return `La imagen no puede pesar más de ${MAXIMO_MB_IMAGEN} MB.`;
    }

    return null;
  }

  async subir(archivo: File, carpeta: CarpetaImagen, prefijo = ''): Promise<string> {
    const problema = this.validar(archivo);
    if (problema) {
      throw new Error(problema);
    }

    const ruta = `${carpeta}/${prefijo}${crypto.randomUUID()}.${EXTENSIONES[archivo.type]}`;
    const almacen = this.supabase.client.storage.from(BUCKET);

    for (let intento = 0; ; intento++) {
      const { error } = await almacen.upload(ruta, archivo, {
        cacheControl: UN_ANIO_EN_SEGUNDOS,
        upsert: false,
      });

      if (!error || (intento > 0 && this.yaExiste(error))) {
        return almacen.getPublicUrl(ruta).data.publicUrl;
      }

      const espera = ESPERAS_REINTENTO_MS[intento];
      if (espera === undefined || !this.esPasajero(error)) {
        throw new Error(this.mensajeDeSubida(error));
      }

      await new Promise((resolver) => setTimeout(resolver, espera));
    }
  }

  rutaPropia(url: string | null | undefined): string | null {
    if (!url || !url.startsWith(this.prefijo)) {
      return null;
    }

    let ruta: string;
    try {
      ruta = decodeURI(url.slice(this.prefijo.length).split(/[?#]/)[0]);
    } catch {
      return null;
    }

    const [carpeta, nombre, ...resto] = ruta.split('/');
    const carpetaValida = CARPETAS.some((opcion) => opcion === carpeta);

    if (!carpetaValida || !nombre || resto.length > 0) {
      return null;
    }

    return ruta;
  }

  esAutomatica(url: string | null | undefined): boolean {
    const ruta = this.rutaPropia(url);
    return ruta !== null && ruta.split('/')[1].startsWith(PREFIJO_AUTOMATICA);
  }

  async borrarSiNoSeUsa(url: string | null | undefined): Promise<boolean> {
    const ruta = this.rutaPropia(url);
    if (!url || !ruta) {
      return false;
    }

    if (await this.enUso(url)) {
      return false;
    }

    const { data, error } = await this.supabase.client.storage.from(BUCKET).remove([ruta]);

    return !error && data.length > 0;
  }

  private async enUso(url: string): Promise<boolean> {
    const contar = (tabla: string, columna: string) =>
      this.supabase.client
        .from(tabla)
        .select('id', { count: 'exact', head: true })
        .eq(columna, url);

    try {
      const respuestas = await Promise.all([
        contar('peliculas', 'imagen_url'),
        contar('peliculas', 'banner_url'),
        contar('productos', 'imagen_url'),
        contar('combos', 'imagen_url'),
      ]);

      return respuestas.some((respuesta) => respuesta.error !== null || (respuesta.count ?? 0) > 0);
    } catch {
      return true;
    }
  }

  private esPasajero(error: ErrorDeAlmacenamiento): boolean {
    const estado = Number(error.status ?? error.statusCode);
    return !Number.isFinite(estado) || estado === 0 || estado === 429 || estado >= 500;
  }

  private yaExiste(error: ErrorDeAlmacenamiento): boolean {
    const codigos = [String(error.status ?? ''), error.statusCode ?? ''];
    return codigos.includes('409') || /already exists|duplicate/i.test(error.message ?? '');
  }

  private mensajeDeSubida(error: ErrorDeAlmacenamiento): string {
    const detalle = (error.message ?? '').toLowerCase();
    const codigos = [String(error.status ?? ''), error.statusCode ?? ''];

    if (codigos.includes('413') || detalle.includes('size')) {
      return `La imagen no puede pesar más de ${MAXIMO_MB_IMAGEN} MB.`;
    }

    if (codigos.includes('415') || detalle.includes('mime')) {
      return 'Ese formato no está permitido. Elegí una imagen JPG, PNG o WEBP.';
    }

    if (
      codigos.includes('401') ||
      codigos.includes('403') ||
      detalle.includes('row-level security')
    ) {
      return 'No tenés permiso para subir imágenes. Volvé a ingresar con una cuenta de administrador.';
    }

    if (detalle.includes('bucket not found')) {
      return 'Todavía no está creado el espacio para guardar imágenes. Avisale al administrador del sistema.';
    }

    return 'No se pudo subir la imagen. Probá de nuevo en unos minutos.';
  }
}
