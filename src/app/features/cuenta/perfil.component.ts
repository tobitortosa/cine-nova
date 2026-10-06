import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { PromocionesService } from '../../core/services/promociones.service';
import { Cupon } from '../../core/models/modelos';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { CampoFechaComponent } from '../../shared/components/campo-fecha.component';
import {
  COLORES_OJOS,
  TIPOS_SANGRE,
  fechaNoFutura,
  validadoresDiasVacaciones,
} from '../../shared/utils/datos-personales';
import { hoyLocal } from '../../shared/utils/ventas';

@Component({
  selector: 'app-perfil',
  imports: [
    RouterLink,
    RouterLinkActive,
    ReactiveFormsModule,
    PrecioPipe,
    CargandoComponent,
    CampoFechaComponent,
  ],
  templateUrl: './perfil.component.html',
  styleUrl: './perfil.component.scss',
})
export class PerfilComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly avisos = inject(NotificacionesService);
  private readonly promociones = inject(PromocionesService);
  private readonly fb = inject(FormBuilder);

  readonly exacto = { exact: true };
  readonly volverACuenta = { volverA: '/cuenta' };

  readonly perfil = this.auth.perfil;
  readonly logueado = this.auth.estaLogueado;
  readonly guardando = signal(false);
  readonly reintentando = signal(false);
  readonly errorPerfil = signal('');
  readonly cupon = signal<Cupon | null>(null);
  readonly yaCompro = signal(false);
  readonly hoy = hoyLocal();

  readonly tiposSangre = TIPOS_SANGRE;
  readonly coloresOjos = COLORES_OJOS;

  readonly formulario = this.fb.group({
    email: this.fb.nonNullable.control({ value: '', disabled: true }),
    nombre: this.fb.nonNullable.control('', [Validators.required, Validators.minLength(2)]),
    apellido: this.fb.nonNullable.control('', [Validators.required, Validators.minLength(2)]),
    fecha_nacimiento: this.fb.nonNullable.control('', [Validators.required, fechaNoFutura]),
    tipo_sangre: this.fb.nonNullable.control('', [Validators.required]),
    color_ojos: this.fb.nonNullable.control('', [Validators.required]),
    dias_vacaciones: this.fb.nonNullable.control(0, validadoresDiasVacaciones),
  });

  readonly puntos = computed(() => this.perfil()?.puntos ?? 0);

  readonly credito = computed(() => this.perfil()?.credito ?? 0);

  readonly fechaBloqueada = computed(() => !!this.perfil()?.fecha_nacimiento);

  readonly mostrarCupon = computed(() => {
    const datos = this.perfil();
    return datos !== null && !datos.cupon_bienvenida_usado && this.cupon() !== null && !this.yaCompro();
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
    if (!datos) return;

    const fecha = this.formulario.controls.fecha_nacimiento;
    if (datos.fecha_nacimiento && fecha.enabled) fecha.disable();
    if (!datos.fecha_nacimiento && fecha.disabled) fecha.enable();

    if (this.formulario.dirty) return;

    this.formulario.patchValue({
      email: datos.email ?? '',
      nombre: datos.nombre ?? '',
      apellido: datos.apellido ?? '',
      fecha_nacimiento: (datos.fecha_nacimiento ?? '').slice(0, 10),
      tipo_sangre: (datos.tipo_sangre ?? '').replace(/^0/, 'O'),
      color_ojos: datos.color_ojos ?? '',
      dias_vacaciones: datos.dias_vacaciones ?? 0,
    });
  });

  async ngOnInit(): Promise<void> {
    if (!this.perfil() && this.logueado()) void this.reintentar();

    const [cupon, yaCompro] = await Promise.all([
      this.promociones.cuponBienvenida().catch(() => null),
      this.auth.tieneCompraPagada().catch(() => false),
    ]);

    this.cupon.set(cupon);
    this.yaCompro.set(yaCompro);
  }

  numero(valor: number): string {
    return this.formatoNumero.format(valor);
  }

  async reintentar(): Promise<void> {
    if (this.reintentando()) return;

    this.reintentando.set(true);
    this.errorPerfil.set('');

    try {
      await this.auth.refrescarPerfil();
      if (!this.perfil() && this.logueado()) this.errorPerfil.set('No encontramos los datos de tu cuenta');
    } catch (e) {
      this.errorPerfil.set(e instanceof Error ? e.message : 'No pudimos cargar tu perfil');
    } finally {
      this.reintentando.set(false);
    }
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
      const cargaFecha = this.formulario.controls.fecha_nacimiento.enabled;

      await this.auth.actualizarPerfil({
        nombre: valores.nombre.trim(),
        apellido: valores.apellido.trim(),
        ...(cargaFecha ? { fecha_nacimiento: valores.fecha_nacimiento || null } : {}),
        tipo_sangre: valores.tipo_sangre,
        color_ojos: valores.color_ojos,
        dias_vacaciones: Math.round(Number(valores.dias_vacaciones)),
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
