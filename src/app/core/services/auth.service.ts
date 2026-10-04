import { Injectable, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthError, Session, SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { ButacasService } from './butacas.service';
import { CarritoService } from './carrito.service';
import { DatosRegistro, Perfil } from '../models/modelos';
import { hoyLocal } from '../../shared/utils/ventas';

const RUTAS_PROTEGIDAS = /^\/(cuenta|admin|empleado)(\/|\?|#|$)/;
const CUENTA_EXISTENTE = 'Ya existe una cuenta con ese email';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);
  private readonly butacas = inject(ButacasService);
  private readonly carrito = inject(CarritoService);

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
  private saliendo = false;

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
        this.llevarAlLoginSiHaceFalta();
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
      if (error.code === 'email_not_confirmed' || mensaje.includes('Email not confirmed')) {
        throw new Error('Todavía no activaste tu cuenta: abrí el enlace que te enviamos por correo');
      }
      if (mensaje.toLowerCase().includes('rate limit')) {
        throw new Error('Hubo demasiados intentos seguidos. Probá de nuevo en unos minutos');
      }
      throw new Error('No pudimos iniciar sesión. Probá de nuevo en unos segundos');
    }

    this.sesion.set(data.session ?? null);
    await this.refrescarPerfil();
  }

  async registrar(datos: DatosRegistro): Promise<boolean> {
    const { data, error } = await this.client.auth.signUp({
      email: datos.email.trim(),
      password: datos.password,
      options: {
        emailRedirectTo: window.location.origin,
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

    if (error) throw new Error(this.mensajeDeRegistro(error));

    if (!data.session && data.user && (data.user.identities?.length ?? 0) === 0) {
      throw new Error(CUENTA_EXISTENTE);
    }

    if (!data.session) return false;

    this.sesion.set(data.session);
    await this.refrescarPerfil().catch(() => this.perfil.set(null));
    return true;
  }

  async salir(): Promise<void> {
    this.saliendo = true;

    try {
      void this.butacas.liberar().catch(() => undefined);
      this.carrito.limpiarButacas();

      const { error } = await this.client.auth.signOut();

      this.sesion.set(null);
      this.perfil.set(null);

      if (error) throw new Error('No pudimos cerrar la sesión');
    } finally {
      this.saliendo = false;
    }
  }

  async tieneCompraPagada(): Promise<boolean> {
    const usuarioId = this.sesion()?.user?.id ?? null;
    if (!usuarioId) return false;

    const { count, error } = await this.client
      .from('compras')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', usuarioId)
      .eq('estado', 'pagada');

    if (error) return false;
    return (count ?? 0) > 0;
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
    const [anioHoy, mesHoy, diaHoy] = hoyLocal().split('-').map(Number);

    let anios = anioHoy - anio;
    if (mesHoy < mes || (mesHoy === mes && diaHoy < dia)) anios--;

    return anios >= 0 ? anios : null;
  }

  private llevarAlLoginSiHaceFalta(): void {
    if (this.saliendo) return;

    const url = this.router.url;
    if (!RUTAS_PROTEGIDAS.test(url)) return;

    setTimeout(() => {
      if (this.estaLogueado() || this.router.url !== url) return;
      void this.router.navigate(['/auth/login'], { queryParams: { volverA: url } });
    });
  }

  private mensajeDeRegistro(error: AuthError): string {
    const codigo = error.code ?? '';
    const mensaje = (error.message ?? '').toLowerCase();

    if (codigo === 'user_already_exists' || codigo === 'email_exists' || mensaje.includes('already registered')) {
      return CUENTA_EXISTENTE;
    }
    if (codigo === 'over_email_send_rate_limit' || codigo === 'over_request_rate_limit' || mensaje.includes('rate limit')) {
      return 'Se hicieron demasiados registros seguidos. Probá de nuevo en unos minutos';
    }
    if (codigo === 'email_address_not_authorized') {
      return 'No pudimos enviar el correo de activación a ese email. Probá con otro en unos minutos';
    }
    if (codigo === 'email_address_invalid') return 'Ese email no parece válido';
    if (codigo === 'weak_password') return 'Elegí una contraseña más segura';
    if (codigo === 'signup_disabled') return 'Por ahora no se pueden crear cuentas nuevas';

    return 'No pudimos crear la cuenta. Revisá los datos e intentá otra vez';
  }
}
