import { Component, OnInit, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { PromocionesService } from '../../core/services/promociones.service';
import { Cupon } from '../../core/models/modelos';
import { destinoDespuesDeIngresar, volverAValido } from '../../core/guards/destino';
import { SelectorFechaComponent } from '../../shared/components/selector-fecha.component';
import {
  COLORES_OJOS,
  TIPOS_SANGRE,
  fechaNoFutura,
  validadoresDiasVacaciones,
} from '../../shared/utils/datos-personales';
import { hoyLocal } from '../../shared/utils/ventas';

const contraseniasIguales: ValidatorFn = (grupo: AbstractControl): ValidationErrors | null => {
  const password = grupo.get('password')?.value ?? '';
  const repetir = grupo.get('repetirPassword')?.value ?? '';
  if (!repetir) return null;
  return password === repetir ? null : { noCoinciden: true };
};

@Component({
  selector: 'app-registro',
  imports: [ReactiveFormsModule, RouterLink, SelectorFechaComponent],
  templateUrl: './registro.component.html',
  styleUrl: './registro.component.scss',
})
export class RegistroComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly avisos = inject(NotificacionesService);
  private readonly promociones = inject(PromocionesService);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);

  readonly enviando = signal(false);
  readonly cupon = signal<Cupon | null>(null);
  readonly hoy = hoyLocal();

  readonly tiposSangre = TIPOS_SANGRE;
  readonly coloresOjos = COLORES_OJOS;

  readonly formulario = this.fb.nonNullable.group(
    {
      nombre: ['', [Validators.required, Validators.minLength(2)]],
      apellido: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      repetirPassword: ['', [Validators.required, Validators.minLength(6)]],
      fechaNacimiento: ['', [Validators.required, fechaNoFutura]],
      tipoSangre: ['', [Validators.required]],
      colorOjos: ['', [Validators.required]],
      diasVacaciones: this.fb.nonNullable.control<number | null>(null, validadoresDiasVacaciones),
    },
    { validators: contraseniasIguales },
  );

  async ngOnInit(): Promise<void> {
    this.cupon.set(await this.promociones.cuponBienvenida().catch(() => null));
  }

  mostrarError(campo: string, error: string): boolean {
    const control = this.formulario.get(campo);
    return control !== null && control.touched && control.hasError(error);
  }

  mostrarNoCoinciden(): boolean {
    const control = this.formulario.controls.repetirPassword;
    return control.touched && control.valid && this.formulario.hasError('noCoinciden');
  }

  async enviar(): Promise<void> {
    if (this.enviando()) return;

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    this.enviando.set(true);
    const datos = this.formulario.getRawValue();
    const email = datos.email.trim();
    const volverA = volverAValido(this.ruta.snapshot.queryParamMap.get('volverA'));

    try {
      const conSesion = await this.auth.registrar({
        email,
        password: datos.password,
        nombre: datos.nombre.trim(),
        apellido: datos.apellido.trim(),
        fecha_nacimiento: datos.fechaNacimiento,
        tipo_sangre: datos.tipoSangre,
        color_ojos: datos.colorOjos,
        dias_vacaciones: Math.round(Number(datos.diasVacaciones ?? 0)),
      });

      if (conSesion) {
        this.avisos.exito(
          this.cupon()
            ? '¡Cuenta creada! Tu cupón de bienvenida ya te está esperando.'
            : '¡Cuenta creada! Ya podés comprar tus entradas.',
        );
        await this.router.navigateByUrl(destinoDespuesDeIngresar(this.auth, volverA));
        return;
      }

      this.avisos.info(`Te enviamos un correo a ${email} para activar tu cuenta.`);
      await this.router.navigate(['/auth/login'], {
        queryParams: volverA ? { volverA } : {},
        state: { emailPorActivar: email },
      });
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'Ocurrió un error');
    } finally {
      this.enviando.set(false);
    }
  }
}
