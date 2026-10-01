import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'precio' })
export class PrecioPipe implements PipeTransform {
  private readonly formato = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  transform(valor: number | null | undefined): string {
    const numero = Number(valor);
    return `$ ${this.formato.format(Number.isFinite(numero) ? numero : 0)}`;
  }
}
