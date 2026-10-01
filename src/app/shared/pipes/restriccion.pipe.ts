import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'restriccion' })
export class RestriccionPipe implements PipeTransform {
  transform(edad: number | null | undefined): string {
    const minima = Math.round(Number(edad) || 0);
    return minima <= 0 ? 'ATP' : `+${minima}`;
  }
}
