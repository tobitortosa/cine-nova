import { Pipe, PipeTransform } from '@angular/core';
import { Butaca } from '../../core/models/modelos';

@Pipe({ name: 'butaca' })
export class ButacaPipe implements PipeTransform {
  transform(butaca: Butaca | null | undefined): string {
    if (!butaca) return '';
    return `${butaca.fila}${butaca.numero}`;
  }
}
