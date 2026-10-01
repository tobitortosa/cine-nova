import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'duracion' })
export class DuracionPipe implements PipeTransform {
  transform(minutos: number | null | undefined): string {
    const total = Math.max(0, Math.round(Number(minutos) || 0));
    const horas = Math.floor(total / 60);
    const resto = total % 60;
    if (horas === 0) return `${resto} min`;
    if (resto === 0) return `${horas} h`;
    return `${horas} h ${resto} min`;
  }
}
