import { DIAS_ABREVIADOS, dosDigitos, esHoraValida, textoLocal } from './fechas';

export interface FuncionDeSerie {
  inicio: string;
  etiqueta: string;
}

export function funcionesDeSerie(
  diasSemana: readonly number[],
  hora: string,
  semanas: number,
  ahora: Date = new Date(),
): FuncionDeSerie[] {
  if (!esHoraValida(hora)) return [];

  const [horas, minutos] = hora.split(':').map(Number);
  const desdeElLunes = Array.from(new Set(diasSemana))
    .filter((dia) => Number.isInteger(dia) && dia >= 0 && dia <= 6)
    .map((dia) => (dia + 6) % 7)
    .sort((a, b) => a - b);
  const lunes = ahora.getDate() - ((ahora.getDay() + 6) % 7);
  const funciones: FuncionDeSerie[] = [];

  for (let semana = 0; semana < semanas; semana++) {
    for (const corrimiento of desdeElLunes) {
      const fecha = new Date(
        ahora.getFullYear(),
        ahora.getMonth(),
        lunes + semana * 7 + corrimiento,
        horas,
        minutos,
      );

      if (fecha.getTime() <= ahora.getTime()) continue;

      funciones.push({
        inicio: textoLocal(fecha),
        etiqueta: `${DIAS_ABREVIADOS[fecha.getDay()]} ${dosDigitos(fecha.getDate())}/${dosDigitos(fecha.getMonth() + 1)} ${hora}`,
      });
    }
  }

  return funciones;
}
