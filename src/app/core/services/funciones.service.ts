import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Funcion, FormatoFuncion, IdiomaFuncion, Sala } from '../models/modelos';
import { esHoraValida } from '../../shared/utils/fechas';
import { funcionesDeSerie } from '../../shared/utils/series';

const CAMPOS_FUNCION = '*, pelicula:peliculas(*), sala:salas(*)';

export interface CambiosFuncion {
  formato: FormatoFuncion;
  idioma: IdiomaFuncion;
  precio_base: number;
  precio_vip: number;
  inicio?: string;
}

@Injectable({ providedIn: 'root' })
export class FuncionesService {
  private readonly supabase = inject(SupabaseService);

  async porPelicula(peliculaId: number): Promise<Funcion[]> {
    const { data, error } = await this.supabase.client
      .from('funciones')
      .select(CAMPOS_FUNCION)
      .eq('pelicula_id', peliculaId)
      .gte('inicio', new Date().toISOString())
      .order('inicio', { ascending: true });

    if (error) {
      throw new Error(error.message || 'No se pudieron cargar las funciones');
    }

    return (data ?? []) as Funcion[];
  }

  async empezoAlguna(peliculaId: number): Promise<boolean> {
    const { count, error } = await this.supabase.client
      .from('funciones')
      .select('id', { count: 'exact', head: true })
      .eq('pelicula_id', peliculaId)
      .lte('inicio', new Date().toISOString());

    return !error && (count ?? 0) > 0;
  }

  async obtener(id: number): Promise<Funcion | null> {
    const { data, error } = await this.supabase.client
      .from('funciones')
      .select(CAMPOS_FUNCION)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(error.message || 'No se pudo cargar la función');
    }

    return data ? (data as Funcion) : null;
  }

  async listar(filtro?: { desde?: string; hasta?: string; peliculaId?: number }): Promise<Funcion[]> {
    let consulta = this.supabase.client.from('funciones').select(CAMPOS_FUNCION);

    if (filtro?.desde) {
      consulta = consulta.gte('inicio', filtro.desde);
    }

    if (filtro?.hasta) {
      consulta = consulta.lte('inicio', filtro.hasta);
    }

    if (filtro?.peliculaId) {
      consulta = consulta.eq('pelicula_id', filtro.peliculaId);
    }

    const { data, error } = await consulta.order('inicio', { ascending: true });

    if (error) {
      throw new Error(error.message || 'No se pudieron cargar las funciones');
    }

    return (data ?? []) as Funcion[];
  }

  async crear(
    peliculaId: number,
    inicio: string,
    formato: FormatoFuncion,
    idioma: IdiomaFuncion,
    precio: number,
    precioVip: number,
  ): Promise<Funcion> {
    const { data, error } = await this.supabase.client.rpc('crear_funcion', {
      p_pelicula_id: peliculaId,
      p_inicio: this.aInstante(inicio).toISOString(),
      p_formato: formato,
      p_idioma: idioma,
      p_precio: precio,
      p_precio_vip: precioVip,
    });

    if (error) {
      throw new Error(
        error.code === '23P01'
          ? 'No hay salas disponibles en ese horario: entre una función y la siguiente tiene que pasar media hora. Probá con otro horario.'
          : error.message || 'No se pudo crear la función',
      );
    }

    const fila = Array.isArray(data) ? data[0] : data;
    if (!fila) {
      throw new Error('No se pudo crear la función');
    }

    return fila as Funcion;
  }

  async crearSerie(
    peliculaId: number,
    diasSemana: number[],
    hora: string,
    semanas: number,
    formato: FormatoFuncion,
    idioma: IdiomaFuncion,
    precio: number,
    precioVip: number,
  ): Promise<{ creadas: number; errores: string[] }> {
    if (!esHoraValida(hora)) {
      throw new Error('La hora indicada no es válida');
    }

    if (diasSemana.length === 0) {
      throw new Error('Elegí al menos un día de la semana');
    }

    let creadas = 0;
    const errores: string[] = [];

    for (const funcion of funcionesDeSerie(diasSemana, hora, semanas)) {
      try {
        await this.crear(peliculaId, funcion.inicio, formato, idioma, precio, precioVip);
        creadas++;
      } catch (e) {
        const motivo = e instanceof Error ? e.message : 'No se pudo crear la función';
        errores.push(`${funcion.etiqueta} — ${motivo}`);
      }
    }

    return { creadas, errores };
  }

  async actualizar(funcion: Funcion, cambios: CambiosFuncion): Promise<void> {
    const fila: Record<string, unknown> = {
      formato: cambios.formato,
      idioma: cambios.idioma,
      precio_base: cambios.precio_base,
      precio_vip: cambios.precio_vip,
    };

    if (cambios.inicio) {
      const inicio = this.aInstante(cambios.inicio);
      if (await this.hayReservasVigentes(funcion.id)) {
        throw new Error(
          'Hay personas eligiendo butacas para esta función, así que por ahora no se puede cambiar el horario. Probá de nuevo en unos minutos.',
        );
      }
      const duracion = this.duracionEnMinutos(funcion);
      fila['inicio'] = inicio.toISOString();
      fila['fin'] = new Date(inicio.getTime() + duracion * 60000).toISOString();
    }

    const { data, error } = await this.supabase.client
      .from('funciones')
      .update(fila)
      .eq('id', funcion.id)
      .select('id');

    if (error) {
      throw new Error(
        error.code === '23P01'
          ? 'En ese horario la sala ya tiene otra función. Entre una función y la siguiente tiene que pasar media hora: elegí otro horario.'
          : error.message || 'No se pudo actualizar la función',
      );
    }

    if (!data || data.length === 0) {
      throw new Error('No se pudo actualizar la función. Recargá la página y volvé a intentar.');
    }
  }

  async entradasVendidas(funcionId: number): Promise<number | null> {
    const { count, error } = await this.supabase.client
      .from('entradas')
      .select('id', { count: 'exact', head: true })
      .eq('funcion_id', funcionId)
      .eq('activa', true);

    if (error) {
      return null;
    }

    return count ?? 0;
  }

  async eliminar(id: number): Promise<void> {
    const { error } = await this.supabase.client.from('funciones').delete().eq('id', id);

    if (error) {
      throw new Error(
        error.code === '23503'
          ? 'La función tiene entradas asociadas y no se puede eliminar.'
          : error.message || 'No se pudo eliminar la función',
      );
    }
  }

  async salas(): Promise<Sala[]> {
    const { data, error } = await this.supabase.client
      .from('salas')
      .select('*')
      .order('nombre', { ascending: true });

    if (error) {
      throw new Error(error.message || 'No se pudieron cargar las salas');
    }

    return (data ?? []) as Sala[];
  }

  async crearSala(nombre: string): Promise<Sala> {
    const { data, error } = await this.supabase.client
      .from('salas')
      .insert({ nombre: nombre.trim() })
      .select('*')
      .single();

    if (error) {
      throw new Error(error.message || 'No se pudo crear la sala');
    }

    return data as Sala;
  }

  async eliminarSala(id: number): Promise<void> {
    const { error } = await this.supabase.client.from('salas').delete().eq('id', id);

    if (error) {
      throw new Error(
        error.code === '23503'
          ? 'La sala tiene funciones asociadas, aunque ya hayan pasado, y no se puede eliminar. Solo se pueden eliminar salas sin funciones.'
          : error.message || 'No se pudo eliminar la sala',
      );
    }
  }

  private async hayReservasVigentes(funcionId: number): Promise<boolean> {
    const { count, error } = await this.supabase.client
      .from('reservas')
      .select('id', { count: 'exact', head: true })
      .eq('funcion_id', funcionId)
      .gt('expira_en', new Date().toISOString());

    return !error && (count ?? 0) > 0;
  }

  private aInstante(texto: string): Date {
    const momento = new Date(texto);

    if (Number.isNaN(momento.getTime())) {
      throw new Error('La fecha y hora de la función no son válidas');
    }

    return momento;
  }

  private duracionEnMinutos(funcion: Funcion): number {
    const deLaPelicula = Number(funcion.pelicula?.duracion_min);
    if (Number.isFinite(deLaPelicula) && deLaPelicula > 0) {
      return deLaPelicula;
    }

    const guardada = (new Date(funcion.fin).getTime() - new Date(funcion.inicio).getTime()) / 60000;
    return Number.isFinite(guardada) && guardada > 0 ? Math.round(guardada) : 120;
  }
}
