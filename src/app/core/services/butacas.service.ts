import { Injectable, inject } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { Butaca, EstadoButaca } from '../models/modelos';

const CLAVE_SESION = 'cinenova_sesion';

const SEGUNDOS_RESERVA = 480;

const LIMITE_RESERVA_MS = 10000;

const SIN_CONEXION_RESERVA =
  'No pudimos comunicarnos para reservar tus butacas. Revisá tu conexión e intentá de nuevo.';

const SIN_CONEXION_ESTADO = 'No pudimos actualizar el mapa de butacas. Revisá tu conexión.';

interface MensajeSesion {
  sesion?: string;
  pregunta?: string;
  respuesta?: string;
}

@Injectable({ providedIn: 'root' })
export class ButacasService {
  private readonly supabase = inject(SupabaseService);

  private canales = 0;

  private actual: string = this.recuperarSesion();

  private readonly consulta: string = crypto.randomUUID();

  constructor() {
    this.detectarDuplicado();
  }

  get sesion(): string {
    return this.actual;
  }

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
    const { data, error, status } = await this.supabase.client.rpc('butacas_estado', {
      p_funcion_id: funcionId,
      p_sesion: this.sesion,
    });

    if (error) {
      throw new Error(
        status === 0 ? SIN_CONEXION_ESTADO : error.message || 'No se pudo consultar el estado de las butacas',
      );
    }

    return (data ?? []) as EstadoButaca[];
  }

  async reservar(funcionId: number, butacaIds: number[]): Promise<number> {
    const { data, error, status } = await this.supabase.client
      .rpc('reservar_butacas', {
        p_funcion_id: funcionId,
        p_butacas: butacaIds,
        p_sesion: this.sesion,
      })
      .abortSignal(AbortSignal.timeout(LIMITE_RESERVA_MS));

    if (error) {
      throw new Error(
        status === 0 ? SIN_CONEXION_RESERVA : error.message || 'No se pudieron reservar las butacas',
      );
    }

    if (butacaIds.length === 0) return 0;

    const segundos = Number(data);
    if (data === null || data === undefined || !Number.isFinite(segundos)) return SEGUNDOS_RESERVA;
    return Math.max(0, Math.floor(segundos));
  }

  async liberar(): Promise<void> {
    await this.reservar(0, []);
  }

  escuchar(funcionId: number, alCambiar: () => void): RealtimeChannel {
    const filtro = `funcion_id=eq.${funcionId}`;

    return this.supabase.client
      .channel(`butacas-funcion-${funcionId}-${++this.canales}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'entradas', filter: filtro }, () => alCambiar())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'entradas', filter: filtro }, () => alCambiar())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'entradas' }, () => alCambiar())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reservas', filter: filtro }, () => alCambiar())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'reservas', filter: filtro }, () => alCambiar())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reservas' }, () => alCambiar())
      .subscribe((estado) => {
        if (estado === 'SUBSCRIBED') alCambiar();
      });
  }

  async dejarDeEscuchar(canal: RealtimeChannel): Promise<void> {
    await this.supabase.client.removeChannel(canal);
  }

  private detectarDuplicado(): void {
    try {
      const canal = new BroadcastChannel(CLAVE_SESION);

      canal.onmessage = ({ data }: MessageEvent<MensajeSesion>) => {
        if (data?.sesion !== this.actual) return;

        if (data.pregunta) {
          canal.postMessage({ sesion: this.actual, respuesta: data.pregunta });
          return;
        }

        if (data.respuesta === this.consulta) {
          this.actual = crypto.randomUUID();
          try {
            sessionStorage.setItem(CLAVE_SESION, this.actual);
          } catch {
            return;
          }
        }
      };

      canal.postMessage({ sesion: this.actual, pregunta: this.consulta });
    } catch {
      return;
    }
  }

  private recuperarSesion(): string {
    try {
      const guardada = sessionStorage.getItem(CLAVE_SESION);
      if (guardada) {
        return guardada;
      }
      const nueva = crypto.randomUUID();
      sessionStorage.setItem(CLAVE_SESION, nueva);
      return nueva;
    } catch {
      return crypto.randomUUID();
    }
  }
}
