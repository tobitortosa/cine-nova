import { Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-no-encontrado',
  imports: [RouterLink],
  templateUrl: './no-encontrado.component.html',
  styleUrl: './no-encontrado.component.scss',
})
export class NoEncontradoComponent {
  private readonly ubicacion = inject(Location);
  private readonly router = inject(Router);

  readonly ruta = this.router.url;

  volverAtras(): void {
    this.ubicacion.back();
  }
}
