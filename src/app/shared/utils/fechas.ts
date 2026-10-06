export const MESES: readonly string[] = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export const DIAS_LARGOS: readonly string[] = [
  'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado',
];

export const DIAS_ABREVIADOS: readonly string[] = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export const HORARIOS_SUGERIDOS: readonly string[] = ['14:00', '16:30', '18:00', '20:30', '22:45'];

export function dosDigitos(valor: number): string {
  return String(valor).padStart(2, '0');
}

export function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

export function diasDelMes(anio: number, mes: number): number {
  if (mes === 2) return esBisiesto(anio) ? 29 : 28;
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

export function armarClave(anio: number, mes: number, dia: number): string {
  return `${String(anio).padStart(4, '0')}-${dosDigitos(mes)}-${dosDigitos(dia)}`;
}

export function normalizarClave(valor: unknown): string {
  if (typeof valor !== 'string') return '';

  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
  if (!partes) return '';

  const anio = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  if (anio < 1 || mes < 1 || mes > 12 || dia < 1 || dia > diasDelMes(anio, mes)) return '';

  return armarClave(anio, mes, dia);
}

export function diaDeLaSemana(clave: string): number {
  const fecha = new Date(Date.UTC(2000, 0, 1));
  fecha.setUTCFullYear(
    Number(clave.slice(0, 4)),
    Number(clave.slice(5, 7)) - 1,
    Number(clave.slice(8, 10)),
  );
  return fecha.getUTCDay();
}

export function describirFecha(clave: string): string {
  const anio = Number(clave.slice(0, 4));
  const mes = Number(clave.slice(5, 7));
  const dia = Number(clave.slice(8, 10));
  return `${DIAS_LARGOS[diaDeLaSemana(clave)]} ${dia} de ${MESES[mes - 1]} de ${anio}`;
}

export function fechaCorta(clave: string): string {
  return `${clave.slice(8, 10)}/${clave.slice(5, 7)}/${clave.slice(0, 4)}`;
}

export function esHoraValida(texto: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(texto);
}

export function textoLocal(fecha: Date): string {
  const dia = armarClave(fecha.getFullYear(), fecha.getMonth() + 1, fecha.getDate());
  return `${dia}T${dosDigitos(fecha.getHours())}:${dosDigitos(fecha.getMinutes())}`;
}
