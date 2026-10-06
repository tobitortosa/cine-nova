import { Pipe, PipeTransform } from '@angular/core';
import { etiquetaRestriccion } from '../utils/restriccion';

@Pipe({ name: 'restriccion' })
export class RestriccionPipe implements PipeTransform {
  transform(edad: number | null | undefined): string {
    return etiquetaRestriccion(edad);
  }
}
