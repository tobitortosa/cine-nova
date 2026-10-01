import { Component, inject } from '@angular/core';
import { NotificacionesService } from '../../core/services/notificaciones.service';

@Component({
  selector: 'app-avisos',
  imports: [],
  templateUrl: './avisos.component.html',
  styleUrl: './avisos.component.scss',
})
export class AvisosComponent {
  private readonly notificaciones = inject(NotificacionesService);

  readonly avisos = this.notificaciones.avisos;

  cerrar(id: number): void {
    this.notificaciones.cerrar(id);
  }
}
