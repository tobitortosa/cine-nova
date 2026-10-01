import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';

const contraseniasIguales: ValidatorFn = (grupo: AbstractControl): ValidationErrors | null => {
  const password = grupo.get('password')?.value ?? '';
  const repetir = grupo.get('repetirPassword')?.value ?? '';
  if (!repetir) return null;
  return password === repetir ? null : { noCoinciden: true };
};

function fechaDeHoy(): string {
  const ahora = new Date();
  const mes = `${ahora.getMonth() + 1}`.padStart(2, '0');
  const dia = `${ahora.getDate()}`.padStart(2, '0');
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

@Component({
  selector: 'app-registro',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './registro.component.html',
  styleUrl: './registro.component.scss',
})
export class RegistroComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly avisos = inject(NotificacionesService);
  private readonly router = inject(Router);

  readonly enviando = signal(false);
  readonly hoy = fechaDeHoy();

  readonly tiposSangre: string[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  readonly coloresOjos: string[] = ['Marrones', 'Negros', 'Verdes', 'Azules', 'Grises', 'Miel'];

  readonly formulario = this.fb.nonNullable.group(
    {
      nombre: ['', [Validators.required, Validators.minLength(2)]],
      apellido: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      repetirPassword: ['', [Validators.required, Validators.minLength(6)]],
      fechaNacimiento: ['', [Validators.required]],
      tipoSangre: ['', [Validators.required]],
      colorOjos: ['', [Validators.required]],
      diasVacaciones: this.fb.nonNullable.control<number | null>(null, [
        Validators.required,
        Validators.min(0),
        Validators.max(365),
      ]),
    },
    { validators: contraseniasIguales },
  );

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

    try {
      await this.auth.registrar({
        email: datos.email,
        password: datos.password,
        nombre: datos.nombre.trim(),
        apellido: datos.apellido.trim(),
        fecha_nacimiento: datos.fechaNacimiento,
        tipo_sangre: datos.tipoSangre,
        color_ojos: datos.colorOjos,
        dias_vacaciones: datos.diasVacaciones ?? 0,
      });

      this.avisos.exito('¡Cuenta creada! Tu cupón de bienvenida ya te está esperando.');
      this.avisos.info('Si te pedimos confirmar la cuenta, revisá tu email para activarla.');
      await this.router.navigateByUrl('/');
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'Ocurrió un error');
    } finally {
      this.enviando.set(false);
    }
  }
}
