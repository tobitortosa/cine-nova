import { hoyLocal } from './ventas';

export const EDAD_ADULTO = 18;

export const LARGO_CODIGO = 12;

export const FORMATO_CODIGO = /^[0-9A-F]{12}$/;

export function edadRestriccion(valor: number | null | undefined): number {
  return Math.max(0, Math.round(Number(valor) || 0));
}

export function etiquetaRestriccion(valor: number | null | undefined): string {
  const minima = edadRestriccion(valor);
  return minima === 0 ? 'ATP' : `+${minima}`;
}

export function edadMinimaLegible(valor: number | null | undefined): string {
  const minima = edadRestriccion(valor);
  return minima === 0 ? 'Apta para todo público' : `Solo para mayores de ${minima} años`;
}

export function avisoRestriccion(valor: number | null | undefined): string {
  const minima = edadRestriccion(valor);

  if (minima === 0) return 'Película ATP: apta para todo público.';

  const base = `Película +${minima}: solo mayores de ${minima}.`;

  return minima < EDAD_ADULTO
    ? `${base} Los menores de ${EDAD_ADULTO} ingresan con un adulto que tenga su propia entrada.`
    : `${base} Se pide DNI en la puerta.`;
}

export function avisoCompraMenor(
  requiereAdulto: boolean | null | undefined,
  adultoCodigo?: string | null,
): string {
  if (!requiereAdulto) return '';

  const codigo = (adultoCodigo ?? '').trim();

  return codigo
    ? `Compra de un menor: entrás con el adulto de la compra ${codigo}`
    : 'Compra de un menor: el adulto que te acompaña está en esta misma compra';
}

export function edadDesde(fecha: string | null | undefined, hoy = hoyLocal()): number | null {
  if (!fecha) return null;

  const partes = fecha.slice(0, 10).split('-').map(Number);
  if (partes.length !== 3 || partes.some((numero) => !Number.isFinite(numero))) return null;

  const [anio, mes, dia] = partes;
  const [anioHoy, mesHoy, diaHoy] = hoy.split('-').map(Number);

  let anios = anioHoy - anio;
  if (mesHoy < mes || (mesHoy === mes && diaHoy < dia)) anios--;

  return anios >= 0 ? anios : null;
}

export function debajoDeEdadMinima(
  restriccion: number | null | undefined,
  edad: number | null,
): boolean {
  const minima = edadRestriccion(restriccion);
  return minima > 0 && edad !== null && edad < minima;
}

export function necesitaAdulto(
  restriccion: number | null | undefined,
  edad: number | null,
): boolean {
  const minima = edadRestriccion(restriccion);
  return minima > 0 && edad !== null && edad >= minima && edad < EDAD_ADULTO;
}

export function normalizarCodigo(valor: string | null | undefined): string {
  return (valor ?? '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[^0-9A-F]/g, '')
    .slice(0, LARGO_CODIGO);
}
