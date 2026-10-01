import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/services/auth.service';
import { NotificacionesService } from '../core/services/notificaciones.service';
import { AvisosComponent } from '../shared/components/avisos.component';

@Component({
  selector: 'app-layout-admin',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AvisosComponent],
  templateUrl: './layout-admin.component.html',
  styleUrl: './layout-admin.component.scss',
})
export class LayoutAdminComponent {
  readonly auth = inject(AuthService);
  private readonly avisos = inject(NotificacionesService);
  private readonly router = inject(Router);

  readonly inicial = computed(() => {
    const perfil = this.auth.perfil();
    const base = (perfil?.nombre ?? perfil?.email ?? '').trim();
    return base.length > 0 ? base.charAt(0).toUpperCase() : '?';
  });

  readonly email = computed(() => this.auth.perfil()?.email ?? '');

  async salir(): Promise<void> {
    try {
      await this.auth.salir();
      this.avisos.exito('Cerraste la sesión');
      await this.router.navigate(['/']);
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudo cerrar la sesión');
    }
  }
}
