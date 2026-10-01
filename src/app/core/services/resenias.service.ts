import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Resenia } from '../models/modelos';

interface PerfilAutor {
  id: string;
  nombre: string | null;
  apellido: string | null;
}

@Injectable({ providedIn: 'root' })
export class ReseniasService {
  private readonly sb = inject(SupabaseService);

  async porPelicula(peliculaId: number): Promise<Resenia[]> {
    const { data, error } = await this.sb.client
      .from('resenias')
      .select('*')
      .eq('pelicula_id', peliculaId)
      .order('creado_en', { ascending: false });

    if (error) throw new Error('No se pudieron cargar las reseñas');

    const lista = (data ?? []) as Resenia[];
    if (lista.length === 0) return [];

    const nombres = await this.nombresDe(lista.map((r) => r.usuario_id));

    return lista.map((resenia) => ({
      ...resenia,
      autor: nombres.get(resenia.usuario_id) ?? 'Usuario',
    }));
  }

  async miResenia(peliculaId: number): Promise<Resenia | null> {
    const usuarioId = await this.usuarioActual();
    if (!usuarioId) return null;

    const { data, error } = await this.sb.client
      .from('resenias')
      .select('*')
      .eq('pelicula_id', peliculaId)
      .eq('usuario_id', usuarioId)
      .maybeSingle();

    if (error) throw new Error('No se pudo cargar tu reseña');
    return (data as Resenia | null) ?? null;
  }

  async guardar(peliculaId: number, estrellas: number, comentario: string): Promise<void> {
    const usuarioId = await this.usuarioActual();
    if (!usuarioId) throw new Error('Tenés que iniciar sesión para dejar una reseña');

    const puntaje = Math.min(5, Math.max(1, Math.round(Number(estrellas) || 0)));

    const { error } = await this.sb.client.from('resenias').upsert(
      {
        pelicula_id: peliculaId,
        usuario_id: usuarioId,
        estrellas: puntaje,
        comentario: (comentario ?? '').trim(),
      },
      { onConflict: 'pelicula_id,usuario_id' },
    );

    if (error) throw new Error('No se pudo guardar la reseña');
  }

  async eliminar(id: number): Promise<void> {
    const { error } = await this.sb.client.from('resenias').delete().eq('id', id);
    if (error) throw new Error('No se pudo eliminar la reseña');
  }

  private async nombresDe(usuarioIds: string[]): Promise<Map<string, string>> {
    const nombres = new Map<string, string>();
    const unicos = [...new Set(usuarioIds)];
    if (unicos.length === 0) return nombres;

    const { data, error } = await this.sb.client
      .from('perfiles')
      .select('id, nombre, apellido')
      .in('id', unicos);

    if (error || !data) return nombres;

    for (const perfil of data as PerfilAutor[]) {
      const completo = `${perfil.nombre ?? ''} ${perfil.apellido ?? ''}`.trim();
      if (completo) nombres.set(perfil.id, completo);
    }

    return nombres;
  }

  private async usuarioActual(): Promise<string | null> {
    const { data } = await this.sb.client.auth.getUser();
    return data.user?.id ?? null;
  }
}
