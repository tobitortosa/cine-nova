import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'desde' })
export class DesdePipe implements PipeTransform {
  transform(fecha: string | Date | null | undefined): string {
    if (!fecha) return '';
    const momento = fecha instanceof Date ? fecha : new Date(fecha);
    const marca = momento.getTime();
    if (Number.isNaN(marca)) return '';

    const segundos = Math.floor((Date.now() - marca) / 1000);
    if (segundos < 0) return 'en instantes';
    if (segundos < 60) return 'hace unos segundos';

    const minutos = Math.floor(segundos / 60);
    if (minutos < 60) return `hace ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;

    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `hace ${horas} ${horas === 1 ? 'hora' : 'horas'}`;

    const dias = Math.floor(horas / 24);
    if (dias === 1) return 'ayer';
    if (dias < 7) return `hace ${dias} días`;

    const semanas = Math.floor(dias / 7);
    if (semanas < 5) return `hace ${semanas} ${semanas === 1 ? 'semana' : 'semanas'}`;

    const meses = Math.floor(dias / 30);
    if (meses < 12) return `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`;

    const anios = Math.floor(dias / 365);
    return `hace ${anios} ${anios === 1 ? 'año' : 'años'}`;
  }
}
