import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { CargandoComponent } from '../../shared/components/cargando.component';

@Component({
  selector: 'app-perfil',
  imports: [RouterLink, RouterLinkActive, ReactiveFormsModule, PrecioPipe, CargandoComponent],
  templateUrl: './perfil.component.html',
  styleUrl: './perfil.component.scss',
})
export class PerfilComponent {
  private readonly auth = inject(AuthService);
  private readonly avisos = inject(NotificacionesService);
  private readonly fb = inject(FormBuilder);

  readonly exacto = { exact: true };

  readonly perfil = this.auth.perfil;
  readonly guardando = signal(false);

  readonly tiposSangre: string[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', '0+', '0-'];
  readonly coloresOjos: string[] = [
    'Marrones',
    'Negros',
    'Miel',
    'Verdes',
    'Celestes',
    'Azules',
    'Grises',
  ];

  readonly formulario = this.fb.group({
    email: this.fb.nonNullable.control({ value: '', disabled: true }),
    nombre: this.fb.nonNullable.control('', [Validators.required, Validators.minLength(2)]),
    apellido: this.fb.nonNullable.control('', [Validators.required, Validators.minLength(2)]),
    fecha_nacimiento: this.fb.nonNullable.control('', [Validators.required]),
    tipo_sangre: this.fb.nonNullable.control('', [Validators.required]),
    color_ojos: this.fb.nonNullable.control('', [Validators.required]),
    dias_vacaciones: this.fb.nonNullable.control(0, [
      Validators.required,
      Validators.min(0),
      Validators.max(365),
    ]),
  });

  readonly puntos = computed(() => this.perfil()?.puntos ?? 0);

  readonly credito = computed(() => this.perfil()?.credito ?? 0);

  readonly mostrarCupon = computed(() => {
    const datos = this.perfil();
    return datos !== null && !datos.cupon_bienvenida_usado;
  });

  readonly miembroDesde = computed(() => {
    const fecha = this.perfil()?.creado_en;
    if (!fecha) return 'Hoy';

    const momento = new Date(fecha);
    if (Number.isNaN(momento.getTime())) return 'Hoy';

    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(momento);
  });

  private readonly formatoNumero = new Intl.NumberFormat('es-AR');

  private readonly sincronia = effect(() => {
    const datos = this.perfil();
    if (!datos || this.formulario.dirty) return;

    this.formulario.patchValue({
      email: datos.email ?? '',
      nombre: datos.nombre ?? '',
      apellido: datos.apellido ?? '',
      fecha_nacimiento: (datos.fecha_nacimiento ?? '').slice(0, 10),
      tipo_sangre: datos.tipo_sangre ?? '',
      color_ojos: datos.color_ojos ?? '',
      dias_vacaciones: datos.dias_vacaciones ?? 0,
    });
  });

  numero(valor: number): string {
    return this.formatoNumero.format(valor);
  }

  async guardar(): Promise<void> {
    if (this.guardando()) return;

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      this.avisos.error('Revisá los campos marcados en rojo');
      return;
    }

    this.guardando.set(true);

    try {
      const valores = this.formulario.getRawValue();

      await this.auth.actualizarPerfil({
        nombre: valores.nombre.trim(),
        apellido: valores.apellido.trim(),
        fecha_nacimiento: valores.fecha_nacimiento || null,
        tipo_sangre: valores.tipo_sangre,
        color_ojos: valores.color_ojos,
        dias_vacaciones: Number(valores.dias_vacaciones),
      });

      this.formulario.markAsPristine();
      this.avisos.exito('Guardamos tus datos');
    } catch (e) {
      this.avisos.error(e instanceof Error ? e.message : 'No pudimos guardar los cambios');
    } finally {
      this.guardando.set(false);
    }
  }
}
