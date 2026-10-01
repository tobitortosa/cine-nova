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
    const { error } = await this.supabase.client.from('productos').delete().eq('id', id);

    if (error) {
      throw new Error(error.message || 'No se pudo eliminar el producto');
    }
  }

  async crearCombo(datos: Partial<Combo>): Promise<Combo> {
    const { data, error } = await this.supabase.client
      .from('combos')
      .insert(this.limpiarCombo(datos))
      .select('*')
      .single();

    if (error) {
      throw new Error(error.message || 'No se pudo crear el combo');
    }

    return data as Combo;
  }

  async actualizarCombo(id: number, datos: Partial<Combo>): Promise<void> {
    const { error } = await this.supabase.client
      .from('combos')
      .update(this.limpiarCombo(datos))
      .eq('id', id);

    if (error) {
      throw new Error(error.message || 'No se pudo actualizar el combo');
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
    return copia;
  }
}
