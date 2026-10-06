import {
  Directive,
  EmbeddedViewRef,
  TemplateRef,
  ViewContainerRef,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { RolUsuario } from '../../core/models/modelos';

@Directive({
  selector: '[appSiRol]',
})
export class SiRolDirective {
  private readonly auth = inject(AuthService);
  private readonly plantilla = inject<TemplateRef<unknown>>(TemplateRef);
  private readonly contenedor = inject(ViewContainerRef);
  private vista: EmbeddedViewRef<unknown> | null = null;

  readonly appSiRol = input.required<RolUsuario | readonly RolUsuario[]>();

  private readonly permitido = computed(() => {
    const rol = this.auth.perfil()?.rol;
    const pedidos = this.appSiRol();
    const roles: readonly RolUsuario[] = typeof pedidos === 'string' ? [pedidos] : pedidos;
    return rol !== undefined && roles.includes(rol);
  });

  constructor() {
    effect(() => {
      const mostrar = this.permitido();

      untracked(() => {
        if (mostrar && !this.vista) {
          this.vista = this.contenedor.createEmbeddedView(this.plantilla);
        } else if (!mostrar && this.vista) {
          this.contenedor.clear();
          this.vista = null;
        }
      });
    });
  }
}
