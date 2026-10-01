import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly avisos = inject(NotificacionesService);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);

  readonly enviando = signal(false);
  readonly verContrasenia = signal(false);

  readonly formulario = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  mostrarError(campo: string, error: string): boolean {
    const control = this.formulario.get(campo);
    return control !== null && control.touched && control.hasError(error);
  }

  alternarContrasenia(): void {
    this.verContrasenia.update((visible) => !visible);
  }

  async enviar(): Promise<void> {
    if (this.enviando()) return;

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    this.enviando.set(true);
    const { email, password } = this.formulario.getRawValue();

    try {
      await this.auth.ingresar(email, password);
      this.avisos.exito('¡Hola de nuevo! Ya estás dentro.');
      await this.router.navigateByUrl(this.destino());
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'Ocurrió un error');
    } finally {
      this.enviando.set(false);
    }
  }

  private destino(): string {
    const volverA = this.ruta.snapshot.queryParamMap.get('volverA');
    return volverA && volverA.startsWith('/') ? volverA : '/';
  }
}
