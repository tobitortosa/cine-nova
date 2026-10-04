import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Categoria, Combo, Producto } from '../models/modelos';

@Injectable({ providedIn: 'root' })
export class CandyService {
  private readonly supabase = inject(SupabaseService);

  async categorias(): Promise<Categoria[]> {
    const { data, error } = await this.supabase.client
      .from('categorias')
      .select('*')
      .order('nombre', { ascending: true });

    if (error) {
      throw new Error('No se pudieron cargar las categorías');
    }

    return (data ?? []) as Categoria[];
  }

  async productos(soloActivos = true): Promise<Producto[]> {
    let consulta = this.supabase.client.from('productos').select('*, categoria:categorias(*)');

    if (soloActivos) {
      consulta = consulta.eq('activo', true);
    }

    const { data, error } = await consulta.order('nombre', { ascending: true });

    if (error) {
      throw new Error('No se pudieron cargar los productos');
    }

    return (data ?? []) as Producto[];
  }

  async combos(soloActivos = true): Promise<Combo[]> {
    let consulta = this.supabase.client.from('combos').select('*');

    if (soloActivos) {
      consulta = consulta.eq('activo', true);
    }

    const { data, error } = await consulta.order('nombre', { ascending: true });

    if (error) {
      throw new Error('No se pudieron cargar los combos');
    }

    return (data ?? []) as Combo[];
  }

  async crearCategoria(nombre: string): Promise<Categoria> {
    const { data, error } = await this.supabase.client
      .from('categorias')
      .insert({ nombre })
      .select('*')
      .single();

    if (error) {
      throw new Error(error.message || 'No se pudo crear la categoría');
    }

    return data as Categoria;
  }

  async actualizarCategoria(id: number, nombre: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('categorias')
      .update({ nombre })
      .eq('id', id);

    if (error) {
      throw new Error(error.message || 'No se pudo actualizar la categoría');
    }
  }

  async eliminarCategoria(id: number): Promise<void> {
    const { error } = await this.supabase.client.from('categorias').delete().eq('id', id);

    if (error) {
      throw new Error(error.message || 'No se pudo eliminar la categoría');
    }
  }

  async crearProducto(datos: Partial<Producto>): Promise<Producto> {
    const { data, error } = await this.supabase.client
      .from('productos')
      .insert(this.limpiarProducto(datos))
      .select('*, categoria:categorias(*)')
      .single();

    if (error) {
      throw new Error(error.message || 'No se pudo crear el producto');
    }

    return data as Producto;
  }

  async actualizarProducto(id: number, datos: Partial<Producto>): Promise<void> {
    const { error } = await this.supabase.client
      .from('productos')
      .update(this.limpiarProducto(datos))
      .eq('id', id);

    if (error) {
      throw new Error(error.message || 'No se pudo actualizar el producto');
    }
  }

  async eliminarProducto(id: number): Promise<void> {
    await this.verificarProductoLibre(id);

    const { error } = await this.supabase.client.from('productos').delete().eq('id', id);

    if (error) {
      throw new Error(
        error.code === '23503'
          ? 'Ese producto tiene canjes o recompensas asociados: desactivalo en lugar de borrarlo.'
          : error.message || 'No se pudo eliminar el producto',
      );
    }
  }

  async crearCombo(datos: Partial<Combo>): Promise<Combo> {
    let fila = this.limpiarCombo(datos);
    let respuesta = await this.supabase.client.from('combos').insert(fila).select('*').single();

    if (respuesta.error && this.faltaColumnaEntradas(respuesta.error)) {
      fila = this.sinEntradasIncluidas(fila);
      respuesta = await this.supabase.client.from('combos').insert(fila).select('*').single();
    }

    if (respuesta.error) {
      throw new Error(respuesta.error.message || 'No se pudo crear el combo');
    }

    return respuesta.data as Combo;
  }

  async actualizarCombo(id: number, datos: Partial<Combo>): Promise<void> {
    let fila = this.limpiarCombo(datos);
    let respuesta = await this.supabase.client.from('combos').update(fila).eq('id', id);

    if (respuesta.error && this.faltaColumnaEntradas(respuesta.error)) {
      fila = this.sinEntradasIncluidas(fila);
      respuesta = await this.supabase.client.from('combos').update(fila).eq('id', id);
    }

    if (respuesta.error) {
      throw new Error(respuesta.error.message || 'No se pudo actualizar el combo');
    }
  }

  async eliminarCombo(id: number): Promise<void> {
    const { error } = await this.supabase.client.from('combos').delete().eq('id', id);

    if (error) {
      throw new Error(error.message || 'No se pudo eliminar el combo');
    }
  }

  private limpiarProducto(datos: Partial<Producto>): Partial<Producto> {
    const copia: Partial<Producto> = { ...datos };
    delete copia.id;
    delete copia.categoria;
    return copia;
  }

  private limpiarCombo(datos: Partial<Combo>): Partial<Combo> {
    const copia: Partial<Combo> = { ...datos };
    delete copia.id;
    if (copia.entradas_incluidas !== undefined) {
      const cantidad = Math.floor(Number(copia.entradas_incluidas));
      copia.entradas_incluidas = Number.isFinite(cantidad) ? Math.min(10, Math.max(0, cantidad)) : 0;
    }
    return copia;
  }

  private faltaColumnaEntradas(error: { message?: string }): boolean {
    return (error.message ?? '').includes('entradas_incluidas');
  }

  private sinEntradasIncluidas(fila: Partial<Combo>): Partial<Combo> {
    if ((fila.entradas_incluidas ?? 0) > 0) {
      throw new Error(
        'Todavía no se pueden guardar combos con entradas incluidas: falta actualizar la base de datos. Guardalo con 0 entradas por ahora.',
      );
    }
    const copia: Partial<Combo> = { ...fila };
    delete copia.entradas_incluidas;
    return copia;
  }

  private async verificarProductoLibre(id: number): Promise<void> {
    const [canjes, recompensas] = await Promise.all([
      this.supabase.client
        .from('canjes')
        .select('id', { count: 'exact', head: true })
        .eq('producto_id', id)
        .eq('usado', false),
      this.supabase.client
        .from('recompensas')
        .select('id', { count: 'exact', head: true })
        .eq('producto_id', id)
        .eq('activo', true),
    ]);

    if (!canjes.error && (canjes.count ?? 0) > 0) {
      throw new Error('Ese producto tiene canjes pendientes: desactivalo en lugar de borrarlo.');
    }

    if (!recompensas.error && (recompensas.count ?? 0) > 0) {
      throw new Error(
        'Ese producto es parte de una recompensa activa: desactivalo en lugar de borrarlo, o primero desactivá la recompensa.',
      );
    }
  }
}
