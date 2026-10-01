import { Component, input } from '@angular/core';

@Component({
  selector: 'app-cargando',
  imports: [],
  templateUrl: './cargando.component.html',
  styleUrl: './cargando.component.scss',
})
export class CargandoComponent {
  readonly texto = input<string>('Cargando...');
}
