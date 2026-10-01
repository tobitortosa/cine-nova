import { Funcion, Pelicula, TipoButaca } from '../../core/models/modelos';

export const DIAS_PREVENTA = 7;

const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';

type DatosVenta = Pick<Pelicula, 'en_cartelera' | 'fecha_estreno' | 'precio_preventa'>;

export function hoyLocal(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function sumarDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

export function diasHasta(fecha: string | null | undefined, hoy = hoyLocal()): number | null {
  if (!fecha) return null;
  const desde = Date.parse(`${hoy}T00:00:00Z`);
  const hasta = Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(desde) || Number.isNaN(hasta)) return null;
  return Math.round((hasta - desde) / 86_400_000);
}

export function tienePreventa(pelicula: DatosVenta | null | undefined): boolean {
  return !!pelicula && pelicula.precio_preventa !== null && pelicula.precio_preventa !== undefined;
}

export function preventaVigente(pelicula: DatosVenta | null | undefined, hoy = hoyLocal()): boolean {
  if (!pelicula || !tienePreventa(pelicula) || !pelicula.fecha_estreno) return false;
  const estreno = pelicula.fecha_estreno.slice(0, 10);
  return hoy >= sumarDias(estreno, -DIAS_PREVENTA) && hoy < estreno;
}

export function ventaAbierta(pelicula: DatosVenta | null | undefined, hoy = hoyLocal()): boolean {
  if (!pelicula) return false;
  if (pelicula.en_cartelera) return true;
  if (!pelicula.fecha_estreno) return false;
  const apertura = sumarDias(pelicula.fecha_estreno, tienePreventa(pelicula) ? -DIAS_PREVENTA : 0);
  return hoy >= apertura;
}

export function finDePreventa(pelicula: DatosVenta | null | undefined): string | null {
  if (!pelicula?.fecha_estreno) return null;
  return sumarDias(pelicula.fecha_estreno, -1);
}

export function precioEntrada(funcion: Funcion | null, tipo: TipoButaca, hoy = hoyLocal()): number {
  if (!funcion) return 0;

  if (preventaVigente(funcion.pelicula, hoy)) {
    const preventa = Number(funcion.pelicula?.precio_preventa ?? 0);
    const centavos = Math.round(preventa * 100);
    return tipo === 'vip' ? Math.round((centavos * 3) / 2) / 100 : centavos / 100;
  }

  return tipo === 'vip' ? Number(funcion.precio_vip) : Number(funcion.precio_base);
}
