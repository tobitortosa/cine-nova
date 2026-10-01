import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Funcion, FormatoFuncion, IdiomaFuncion, Sala } from '../models/modelos';

const CAMPOS_FUNCION = '*, pelicula:peliculas(*), sala:salas(*)';

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
      p_inicio: inicio,
      p_formato: formato,
      p_idioma: idioma,
      p_precio: precio,
      p_precio_vip: precioVip,
    });

    if (error) {
      throw new Error(error.message || 'No se pudo crear la función');
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
    const partes = hora.split(':');
    const horas = Number(partes[0]);
    const minutos = Number(partes[1] ?? '0');

    if (!Number.isFinite(horas) || !Number.isFinite(minutos)) {
      throw new Error('La hora indicada no es válida');
    }

    const dias = Array.from(new Set(diasSemana)).sort((a, b) => a - b);
    if (dias.length === 0) {
      throw new Error('Elegí al menos un día de la semana');
    }

    const ahora = new Date();
    const domingoBase = new Date(
      ahora.getFullYear(),
      ahora.getMonth(),
      ahora.getDate() - ahora.getDay(),
    );

    let creadas = 0;
    const errores: string[] = [];

    for (let semana = 0; semana < semanas; semana++) {
      for (const dia of dias) {
        const fecha = new Date(domingoBase);
        fecha.setDate(domingoBase.getDate() + semana * 7 + dia);
        fecha.setHours(horas, minutos, 0, 0);

        if (fecha.getTime() <= ahora.getTime()) {
          continue;
        }

        try {
          await this.crear(
            peliculaId,
            this.aTextoLocal(fecha),
            formato,
            idioma,
            precio,
            precioVip,
          );
          creadas++;
        } catch (e) {
          const motivo = e instanceof Error ? e.message : 'No se pudo crear la función';
          errores.push(`${this.etiqueta(fecha)} — ${motivo}`);
        }
      }
    }

    return { creadas, errores };
  }

  async eliminar(id: number): Promise<void> {
    const { error } = await this.supabase.client.from('funciones').delete().eq('id', id);

    if (error) {
      throw new Error(error.message || 'No se pudo eliminar la función');
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
      throw new Error(error.message || 'No se pudo eliminar la sala');
    }
  }

  private aTextoLocal(fecha: Date): string {
    const anio = fecha.getFullYear();
    const mes = this.dosDigitos(fecha.getMonth() + 1);
    const dia = this.dosDigitos(fecha.getDate());
    const horas = this.dosDigitos(fecha.getHours());
    const minutos = this.dosDigitos(fecha.getMinutes());

    return `${anio}-${mes}-${dia}T${horas}:${minutos}`;
  }

  private etiqueta(fecha: Date): string {
    const dia = this.dosDigitos(fecha.getDate());
    const mes = this.dosDigitos(fecha.getMonth() + 1);
    const horas = this.dosDigitos(fecha.getHours());
    const minutos = this.dosDigitos(fecha.getMinutes());

    return `${dia}/${mes} ${horas}:${minutos}`;
  }

  private dosDigitos(valor: number): string {
    return String(valor).padStart(2, '0');
  }
}
