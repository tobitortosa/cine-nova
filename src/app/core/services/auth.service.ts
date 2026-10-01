import { Injectable, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { Session, SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { DatosRegistro, Perfil } from '../models/modelos';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService);

  readonly sesion: WritableSignal<Session | null> = signal<Session | null>(null);
  readonly perfil: WritableSignal<Perfil | null> = signal<Perfil | null>(null);
  readonly cargando: WritableSignal<boolean> = signal(true);

  readonly estaLogueado: Signal<boolean> = computed(() => this.sesion() !== null);

  readonly esAdmin: Signal<boolean> = computed(() => this.perfil()?.rol === 'admin');

  readonly esEmpleado: Signal<boolean> = computed(() => {
    const rol = this.perfil()?.rol;
    return rol === 'empleado' || rol === 'admin';
  });

  readonly nombreCompleto: Signal<string> = computed(() => {
    const datos = this.perfil();
    if (!datos) return '';
    return `${datos.nombre ?? ''} ${datos.apellido ?? ''}`.trim();
  });

  private arranque: Promise<void> | null = null;
  private escuchando = false;

  private get client(): SupabaseClient {
    return this.supabase.client;
  }

  async inicializar(): Promise<void> {
    this.arranque ??= this.arrancar();
    return this.arranque;
  }

  private async arrancar(): Promise<void> {
    try {
      const { data } = await this.client.auth.getSession();
      this.sesion.set(data.session ?? null);
    } catch {
      this.sesion.set(null);
    }

    try {
      await this.refrescarPerfil();
    } catch {
      this.perfil.set(null);
    }

    this.escucharCambios();
    this.cargando.set(false);
  }

  private escucharCambios(): void {
    if (this.escuchando) return;
    this.escuchando = true;

    this.client.auth.onAuthStateChange((_evento, sesion) => {
      this.sesion.set(sesion ?? null);

      if (!sesion) {
        this.perfil.set(null);
        return;
      }

      if (this.perfil()?.id === sesion.user.id) return;

      setTimeout(() => {
        this.refrescarPerfil().catch(() => this.perfil.set(null));
      });
    });
  }

  async ingresar(email: string, password: string): Promise<void> {
    const { data, error } = await this.client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      const mensaje = error.message ?? '';
      if (mensaje.includes('Invalid login credentials')) {
        throw new Error('El email o la contraseña no son correctos');
      }
      if (mensaje.includes('Email not confirmed')) {
        throw new Error('Tenés que confirmar tu email antes de ingresar');
      }
      throw new Error('No pudimos iniciar sesión. Probá de nuevo en unos segundos');
    }

    this.sesion.set(data.session ?? null);
    await this.refrescarPerfil();
  }

  async registrar(datos: DatosRegistro): Promise<void> {
    const { data, error } = await this.client.auth.signUp({
      email: datos.email.trim(),
      password: datos.password,
      options: {
        data: {
          nombre: datos.nombre,
          apellido: datos.apellido,
          fecha_nacimiento: datos.fecha_nacimiento,
          tipo_sangre: datos.tipo_sangre,
          color_ojos: datos.color_ojos,
          dias_vacaciones: datos.dias_vacaciones,
        },
      },
    });

    if (error) {
      const mensaje = error.message ?? '';
      if (mensaje.toLowerCase().includes('already registered')) {
        throw new Error('Ya existe una cuenta con ese email');
      }
      throw new Error('No pudimos crear la cuenta. Revisá los datos e intentá otra vez');
    }

    if (data.session) {
      this.sesion.set(data.session);
      await this.refrescarPerfil();
    }
  }

  async salir(): Promise<void> {
    const { error } = await this.client.auth.signOut();

    this.sesion.set(null);
    this.perfil.set(null);

    if (error) throw new Error('No pudimos cerrar la sesión');
  }

  async refrescarPerfil(): Promise<void> {
    const usuarioId = this.sesion()?.user?.id ?? null;

    if (!usuarioId) {
      this.perfil.set(null);
      return;
    }

    const { data, error } = await this.client
      .from('perfiles')
      .select('*')
      .eq('id', usuarioId)
      .maybeSingle();

    if (error) throw new Error('No pudimos cargar tu perfil');

    this.perfil.set((data as Perfil | null) ?? null);
  }

  async actualizarPerfil(cambios: Partial<Perfil>): Promise<void> {
    const usuarioId = this.sesion()?.user?.id ?? null;
    if (!usuarioId) throw new Error('Tenés que iniciar sesión para editar tu perfil');

    const { error } = await this.client.from('perfiles').update(cambios).eq('id', usuarioId);

    if (error) throw new Error(error.message || 'No pudimos guardar los cambios');

    await this.refrescarPerfil();
  }

  edad(): number | null {
    const nacimiento = this.perfil()?.fecha_nacimiento;
    if (!nacimiento) return null;

    const partes = nacimiento.slice(0, 10).split('-').map(Number);
    if (partes.length !== 3 || partes.some(valor => !Number.isFinite(valor))) return null;

    const [anio, mes, dia] = partes;
    const hoy = new Date();

    let anios = hoy.getFullYear() - anio;
    const mesActual = hoy.getMonth() + 1;
    if (mesActual < mes || (mesActual === mes && hoy.getDate() < dia)) anios--;

    return anios >= 0 ? anios : null;
  }
}
