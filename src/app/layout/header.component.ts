import { Component, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { filter, map } from 'rxjs';
import { AuthService } from '../core/services/auth.service';
import { CarritoService } from '../core/services/carrito.service';
import { NotificacionesService } from '../core/services/notificaciones.service';
import { SiRolDirective } from '../shared/directives/si-rol.directive';

@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive, ReactiveFormsModule, SiRolDirective],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
})
export class HeaderComponent {
  readonly auth = inject(AuthService);
  readonly carrito = inject(CarritoService);
  private readonly avisos = inject(NotificacionesService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly anfitrion = inject(ElementRef);

  readonly enlaces = [
    { ruta: '/peliculas', texto: 'Cartelera' },
    { ruta: '/proximamente', texto: 'Próximamente' },
    { ruta: '/candy', texto: 'Candy bar' },
  ];

  readonly formulario = this.fb.group({ busqueda: [''] });

  readonly menuAbierto = signal(false);
  readonly menuMovilAbierto = signal(false);
  readonly desplazado = signal(false);

  readonly inicial = computed(() => {
    const perfil = this.auth.perfil();
    const base = (perfil?.nombre ?? perfil?.email ?? '').trim();
    return base.length > 0 ? base.charAt(0).toUpperCase() : '?';
  });

  readonly puntos = computed(() => this.auth.perfil()?.puntos ?? 0);
  readonly email = computed(() => this.auth.perfil()?.email ?? '');

  private readonly urlActual = toSignal(
    this.router.events.pipe(
      filter((evento) => evento instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly volverA = computed(() => {
    const url = this.urlActual();
    return url === '/' ? {} : { volverA: url };
  });

  @HostListener('window:scroll')
  alDesplazar(): void {
    this.desplazado.set(window.scrollY > 8);
  }

  @HostListener('document:click', ['$event'])
  alClickear(evento: MouseEvent): void {
    if (!this.anfitrion.nativeElement.contains(evento.target as Node)) {
      this.cerrarTodo();
    }
  }

  @HostListener('document:keydown.escape')
  alPresionarEscape(): void {
    this.cerrarTodo();
  }

  alternarMenu(): void {
    this.menuMovilAbierto.set(false);
    this.menuAbierto.update(abierto => !abierto);
  }

  alternarMenuMovil(): void {
    this.menuAbierto.set(false);
    this.menuMovilAbierto.update(abierto => !abierto);
  }

  cerrarTodo(): void {
    this.menuAbierto.set(false);
    this.menuMovilAbierto.set(false);
  }

  buscar(): void {
    const texto = (this.formulario.value.busqueda ?? '').trim();
    this.cerrarTodo();
    this.router.navigate(['/peliculas'], {
      queryParams: texto.length > 0 ? { busqueda: texto } : {},
    });
  }

  async salir(): Promise<void> {
    this.cerrarTodo();
    try {
      await this.auth.salir();
      this.avisos.exito('Cerraste la sesión');
      await this.router.navigate(['/']);
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No se pudo cerrar la sesión');
    }
  }
}
