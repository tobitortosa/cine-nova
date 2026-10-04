import { Component, OnInit, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { PromocionesService } from '../../core/services/promociones.service';
import { Cupon } from '../../core/models/modelos';
import { destinoDespuesDeIngresar } from '../../core/guards/destino';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly avisos = inject(NotificacionesService);
  private readonly promociones = inject(PromocionesService);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);
  private readonly ubicacion = inject(Location);

  readonly enviando = signal(false);
  readonly verContrasenia = signal(false);
  readonly cupon = signal<Cupon | null>(null);
  readonly emailPorActivar = signal(this.emailRecienRegistrado());

  readonly formulario = this.fb.nonNullable.group({
    email: [this.emailPorActivar(), [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  async ngOnInit(): Promise<void> {
    this.cupon.set(await this.promociones.cuponBienvenida().catch(() => null));
  }

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
    return destinoDespuesDeIngresar(this.auth, this.ruta.snapshot.queryParamMap.get('volverA'));
  }

  private emailRecienRegistrado(): string {
    const estado = (this.router.currentNavigation()?.extras.state ?? this.ubicacion.getState()) as
      { emailPorActivar?: unknown } | null | undefined;
    return typeof estado?.emailPorActivar === 'string' ? estado.emailPorActivar : '';
  }
}
