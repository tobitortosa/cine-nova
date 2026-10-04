import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Genero, Pelicula, PeliculaVendida } from '../models/modelos';
import { hoyLocal } from '../../shared/utils/ventas';

const CAMPOS_PELICULA = '*, peliculas_generos(generos(*)), resenias(estrellas)';

interface VinculoGenero {
  generos: Genero | Genero[] | null;
}

interface EstrellaSuelta {
  estrellas: number;
}

interface FilaPelicula extends Pelicula {
  peliculas_generos?: VinculoGenero[] | null;
  resenias?: EstrellaSuelta[] | null;
}

@Injectable({ providedIn: 'root' })
export class PeliculasService {
  private readonly supabase = inject(SupabaseService);

  async listar(opciones?: {
    enCartelera?: boolean;
    busqueda?: string;
    generoId?: number | null;
  }): Promise<Pelicula[]> {
    let consulta = this.supabase.client.from('peliculas').select(CAMPOS_PELICULA);

    if (opciones?.enCartelera !== undefined) {
      consulta = consulta.eq('en_cartelera', opciones.enCartelera);
    }

    const busqueda = opciones?.busqueda?.trim() ?? '';
    if (busqueda.length > 0) {
      consulta = consulta.ilike('titulo', `%${busqueda}%`);
    }

    const { data, error } = await consulta
      .order('destacada', { ascending: false })
      .order('titulo', { ascending: true });

    if (error) {
      throw new Error(error.message || 'No se pudieron cargar las películas');
    }

    const peliculas = ((data ?? []) as FilaPelicula[]).map((fila) => this.armar(fila));
    const generoId = opciones?.generoId ?? null;

    if (generoId === null) {
      return peliculas;
    }

    return peliculas.filter((pelicula) =>
      (pelicula.generos ?? []).some((genero) => genero.id === generoId),
    );
  }

  async obtener(id: number): Promise<Pelicula | null> {
    const { data, error } = await this.supabase.client
      .from('peliculas')
      .select(CAMPOS_PELICULA)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(error.message || 'No se pudo cargar la película');
    }

    return data ? this.armar(data as FilaPelicula) : null;
  }

  async proximosEstrenos(): Promise<Pelicula[]> {
    const { data, error } = await this.supabase.client
      .from('peliculas')
      .select(CAMPOS_PELICULA)
      .eq('en_cartelera', false)
      .gte('fecha_estreno', hoyLocal())
      .order('fecha_estreno', { ascending: true });

    if (error) {
      throw new Error(error.message || 'No se pudieron cargar los próximos estrenos');
    }

    return ((data ?? []) as FilaPelicula[]).map((fila) => this.armar(fila));
  }

  async masVendidas(limite = 3, dias = 30): Promise<PeliculaVendida[]> {
    const { data, error } = await this.supabase.client.rpc('peliculas_mas_vendidas', {
      p_limite: limite,
      p_dias: dias,
    });

    if (error) {
      throw new Error(error.message || 'No se pudieron cargar las películas más vendidas');
    }

    return (data ?? []) as PeliculaVendida[];
  }

  async generos(): Promise<Genero[]> {
    const { data, error } = await this.supabase.client
      .from('generos')
      .select('*')
      .order('nombre', { ascending: true });

    if (error) {
      throw new Error(error.message || 'No se pudieron cargar los géneros');
    }

    return (data ?? []) as Genero[];
  }

  async crear(datos: Partial<Pelicula>, generoIds: number[]): Promise<Pelicula> {
    const { data, error } = await this.supabase.client
      .from('peliculas')
      .insert(this.aFila(datos))
      .select('*')
      .single();

    if (error) {
      throw new Error(error.message || 'No se pudo crear la película');
    }

    const creada = data as Pelicula;
    await this.sincronizarGeneros(creada.id, generoIds);

    const completa = await this.obtener(creada.id);
    return completa ?? creada;
  }

  async actualizar(id: number, datos: Partial<Pelicula>, generoIds: number[]): Promise<void> {
    const { error } = await this.supabase.client
      .from('peliculas')
      .update(this.aFila(datos))
      .eq('id', id);

    if (error) {
      throw new Error(
        error.code === '23P01'
          ? 'Con la nueva duración alguna función se superpone con otra de la misma sala. Reprogramá esas funciones antes de cambiarla.'
          : error.message || 'No se pudo actualizar la película',
      );
    }

    await this.sincronizarGeneros(id, generoIds);
  }

  async entradasVendidas(peliculaId: number): Promise<number | null> {
    const { count, error } = await this.supabase.client
      .from('entradas')
      .select('id, funciones!inner(pelicula_id)', { count: 'exact', head: true })
      .eq('activa', true)
      .eq('funciones.pelicula_id', peliculaId);

    if (error) {
      return null;
    }

    return count ?? 0;
  }

  async eliminar(id: number): Promise<void> {
    const { error } = await this.supabase.client.from('peliculas').delete().eq('id', id);

    if (error) {
      throw new Error(
        error.code === '23503'
          ? 'La película tiene ventas asociadas y no se puede eliminar. Sacala de cartelera en lugar de borrarla.'
          : error.message || 'No se pudo eliminar la película',
      );
    }
  }

  async misAlertas(): Promise<number[]> {
    const usuarioId = await this.usuarioActual();
    if (!usuarioId) {
      return [];
    }

    const { data, error } = await this.supabase.client
      .from('alertas_estreno')
      .select('pelicula_id')
      .eq('usuario_id', usuarioId);

    if (error) {
      throw new Error(error.message || 'No se pudieron cargar tus alertas');
    }

    return ((data ?? []) as { pelicula_id: number }[]).map((fila) => fila.pelicula_id);
  }

  async alternarAlerta(peliculaId: number): Promise<boolean> {
    const usuarioId = await this.usuarioActual();
    if (!usuarioId) {
      throw new Error('Tenés que iniciar sesión para activar la alerta');
    }

    const { data, error } = await this.supabase.client
      .from('alertas_estreno')
      .select('id')
      .eq('usuario_id', usuarioId)
      .eq('pelicula_id', peliculaId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message || 'No se pudo consultar la alerta');
    }

    if (data) {
      const { error: errorBaja } = await this.supabase.client
        .from('alertas_estreno')
        .delete()
        .eq('id', (data as { id: number }).id);

      if (errorBaja) {
        throw new Error(errorBaja.message || 'No se pudo quitar la alerta');
      }

      return false;
    }

    const { error: errorAlta } = await this.supabase.client
      .from('alertas_estreno')
      .insert({ usuario_id: usuarioId, pelicula_id: peliculaId });

    if (errorAlta) {
      throw new Error(errorAlta.message || 'No se pudo activar la alerta');
    }

    return true;
  }

  private async usuarioActual(): Promise<string | null> {
    const { data } = await this.supabase.client.auth.getUser();
    return data.user?.id ?? null;
  }

  private async sincronizarGeneros(peliculaId: number, generoIds: number[]): Promise<void> {
    const deseados = Array.from(new Set(generoIds));

    const { data, error } = await this.supabase.client
      .from('peliculas_generos')
      .select('genero_id')
      .eq('pelicula_id', peliculaId);

    if (error) {
      throw new Error(error.message || 'No se pudieron leer los géneros de la película');
    }

    const actuales = ((data ?? []) as { genero_id: number }[]).map((fila) => fila.genero_id);
    const sobrantes = actuales.filter((id) => !deseados.includes(id));
    const nuevos = deseados.filter((id) => !actuales.includes(id));

    if (sobrantes.length > 0) {
      const { error: errorBaja } = await this.supabase.client
        .from('peliculas_generos')
        .delete()
        .eq('pelicula_id', peliculaId)
        .in('genero_id', sobrantes);

      if (errorBaja) {
        throw new Error(errorBaja.message || 'No se pudieron quitar los géneros');
      }
    }

    if (nuevos.length > 0) {
      const { error: errorAlta } = await this.supabase.client
        .from('peliculas_generos')
        .insert(nuevos.map((generoId) => ({ pelicula_id: peliculaId, genero_id: generoId })));

      if (errorAlta) {
        throw new Error(errorAlta.message || 'No se pudieron asignar los géneros');
      }
    }
  }

  private aFila(datos: Partial<Pelicula>): Record<string, unknown> {
    const columnas: (keyof Pelicula)[] = [
      'titulo',
      'sinopsis',
      'duracion_min',
      'imagen_url',
      'banner_url',
      'restriccion_edad',
      'fecha_estreno',
      'precio_preventa',
      'en_cartelera',
      'destacada',
    ];

    const fila: Record<string, unknown> = {};
    for (const columna of columnas) {
      const valor = datos[columna];
      if (valor !== undefined) {
        fila[columna] = valor;
      }
    }

    return fila;
  }

  private armar(fila: FilaPelicula): Pelicula {
    const generos = (fila.peliculas_generos ?? [])
      .map((vinculo) => this.aGenero(vinculo.generos))
      .filter((genero): genero is Genero => genero !== null)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    const estrellas = (fila.resenias ?? []).map((resenia) => resenia.estrellas);
    const total = estrellas.length;
    const suma = estrellas.reduce((acumulado, valor) => acumulado + valor, 0);
    const promedio = total > 0 ? Math.round((suma / total) * 10) / 10 : 0;

    return {
      id: fila.id,
      titulo: fila.titulo,
      sinopsis: fila.sinopsis,
      duracion_min: fila.duracion_min,
      imagen_url: fila.imagen_url,
      banner_url: fila.banner_url,
      restriccion_edad: fila.restriccion_edad,
      fecha_estreno: fila.fecha_estreno,
      precio_preventa: fila.precio_preventa,
      en_cartelera: fila.en_cartelera,
      destacada: fila.destacada,
      creado_en: fila.creado_en,
      generos,
      promedio,
      total_resenias: total,
    };
  }

  private aGenero(valor: Genero | Genero[] | null | undefined): Genero | null {
    if (!valor) {
      return null;
    }

    if (Array.isArray(valor)) {
      return valor.length > 0 ? valor[0] : null;
    }

    return valor;
  }
}
