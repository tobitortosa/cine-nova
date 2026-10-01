import { Injectable, inject } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { Butaca, EstadoButaca } from '../models/modelos';

const CLAVE_SESION = 'cinenova_sesion';

@Injectable({ providedIn: 'root' })
export class ButacasService {
  private readonly supabase = inject(SupabaseService);

  readonly sesion: string = this.recuperarSesion();

  async porSala(salaId: number): Promise<Butaca[]> {
    const { data, error } = await this.supabase.client
      .from('butacas')
      .select('*')
      .eq('sala_id', salaId)
      .order('fila', { ascending: true })
      .order('numero', { ascending: true });

    if (error) {
      throw new Error('No se pudieron cargar las butacas de la sala');
    }

    return (data ?? []) as Butaca[];
  }

  async estado(funcionId: number): Promise<EstadoButaca[]> {
    const { data, error } = await this.supabase.client.rpc('butacas_estado', {
      p_funcion_id: funcionId,
      p_sesion: this.sesion,
    });

    if (error) {
      throw new Error(error.message || 'No se pudo consultar el estado de las butacas');
    }

    return (data ?? []) as EstadoButaca[];
  }

  async reservar(funcionId: number, butacaIds: number[]): Promise<void> {
    const { error } = await this.supabase.client.rpc('reservar_butacas', {
      p_funcion_id: funcionId,
      p_butacas: butacaIds,
      p_sesion: this.sesion,
    });

    if (error) {
      throw new Error(error.message || 'No se pudieron reservar las butacas');
    }
  }

  escuchar(funcionId: number, alCambiar: () => void): RealtimeChannel {
    return this.supabase.client
      .channel('butacas-funcion-' + funcionId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entradas' }, () => alCambiar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservas' }, () => alCambiar())
      .subscribe();
  }

  async dejarDeEscuchar(canal: RealtimeChannel): Promise<void> {
    await this.supabase.client.removeChannel(canal);
  }

  private recuperarSesion(): string {
    try {
      const guardada = localStorage.getItem(CLAVE_SESION);
      if (guardada) {
        return guardada;
      }
      const nueva = crypto.randomUUID();
      localStorage.setItem(CLAVE_SESION, nueva);
      return nueva;
    } catch {
      return crypto.randomUUID();
    }
  }
}
