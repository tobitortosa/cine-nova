import { Injectable, computed, signal } from '@angular/core';
import { Butaca, Combo, Funcion, ItemCarrito, Producto } from '../models/modelos';
import { precioEntrada } from '../../shared/utils/ventas';

const CLAVE_CARRITO = 'cinenova_carrito';

export const TOPE_UNIDADES = 20;

@Injectable({ providedIn: 'root' })
export class CarritoService {
  readonly funcion = signal<Funcion | null>(null);
  readonly butacas = signal<Butaca[]>([]);
  readonly items = signal<ItemCarrito[]>(this.leerGuardados());

  readonly totalEntradas = computed(() =>
    this.butacas().reduce((suma, butaca) => suma + this.precioDe(butaca), 0),
  );

  readonly totalProductos = computed(() =>
    this.items().reduce((suma, item) => suma + item.precio_unitario * item.cantidad, 0),
  );

  readonly subtotal = computed(() => this.totalEntradas() + this.totalProductos());

  readonly cantidadProductos = computed(() =>
    this.items().reduce((suma, item) => suma + item.cantidad, 0),
  );

  setFuncion(f: Funcion | null): void {
    if (this.funcion()?.id !== f?.id) {
      this.butacas.set([]);
    }
    this.funcion.set(f);
  }

  alternarButaca(b: Butaca): void {
    this.butacas.update((lista) =>
      lista.some((butaca) => butaca.id === b.id)
        ? lista.filter((butaca) => butaca.id !== b.id)
        : [...lista, b],
    );
  }

  estaSeleccionada(id: number): boolean {
    return this.butacas().some((butaca) => butaca.id === id);
  }

  limpiarButacas(): void {
    this.butacas.set([]);
  }

  agregarProducto(item: ItemCarrito): void {
    this.items.update((lista) => {
      const indice = lista.findIndex(
        (fila) => fila.producto_id === item.producto_id && fila.combo_id === item.combo_id,
      );

      if (indice === -1) {
        return [...lista, { ...item, cantidad: Math.min(TOPE_UNIDADES, item.cantidad) }];
      }

      return lista.map((fila, i) =>
        i === indice
          ? { ...fila, cantidad: Math.min(TOPE_UNIDADES, fila.cantidad + item.cantidad) }
          : fila,
      );
    });
    this.guardar();
  }

  cantidadDe(productoId: number | null, comboId: number | null): number {
    return (
      this.items().find((item) => item.producto_id === productoId && item.combo_id === comboId)
        ?.cantidad ?? 0
    );
  }

  quitarProducto(indice: number): void {
    this.items.update((lista) => lista.filter((_, i) => i !== indice));
    this.guardar();
  }

  cambiarCantidad(indice: number, cantidad: number): void {
    if (cantidad < 1) {
      this.quitarProducto(indice);
      return;
    }

    const tope = Math.min(TOPE_UNIDADES, cantidad);

    this.items.update((lista) =>
      lista.map((fila, i) => (i === indice ? { ...fila, cantidad: tope } : fila)),
    );
    this.guardar();
  }

  sincronizarConCatalogo(productos: Producto[], combos: Combo[]): string[] {
    const quitados: string[] = [];

    const vigentes = this.items().flatMap((item) => {
      const fuente = item.producto_id !== null
        ? productos.find((producto) => producto.id === item.producto_id && producto.activo)
        : combos.find((combo) => combo.id === item.combo_id && combo.activo);

      if (!fuente) {
        quitados.push(item.nombre);
        return [];
      }

      return [{ ...item, nombre: fuente.nombre, precio_unitario: Number(fuente.precio), imagen_url: fuente.imagen_url }];
    });

    this.items.set(vigentes);
    this.guardar();
    return quitados;
  }

  limpiar(): void {
    this.funcion.set(null);
    this.butacas.set([]);
    this.items.set([]);
    try {
      localStorage.removeItem(CLAVE_CARRITO);
    } catch {
      return;
    }
  }

  precioDe(b: Butaca): number {
    return precioEntrada(this.funcion(), b.tipo);
  }

  precioEstandar(): number {
    return precioEntrada(this.funcion(), 'estandar');
  }

  private guardar(): void {
    try {
      localStorage.setItem(CLAVE_CARRITO, JSON.stringify(this.items()));
    } catch {
      return;
    }
  }

  private leerGuardados(): ItemCarrito[] {
    try {
      const crudo = localStorage.getItem(CLAVE_CARRITO);
      if (!crudo) {
        return [];
      }
      const guardados: unknown = JSON.parse(crudo);
      if (!Array.isArray(guardados)) {
        return [];
      }
      return guardados
        .filter((item): item is ItemCarrito => this.esItemValido(item))
        .map((item) => ({ ...item, cantidad: Math.min(TOPE_UNIDADES, item.cantidad) }));
    } catch {
      return [];
    }
  }

  private esItemValido(item: unknown): boolean {
    if (!item || typeof item !== 'object') {
      return false;
    }

    const fila = item as Partial<ItemCarrito>;
    const producto = fila.producto_id ?? null;
    const combo = fila.combo_id ?? null;

    return (
      (producto === null) !== (combo === null) &&
      (producto === null || Number.isInteger(producto)) &&
      (combo === null || Number.isInteger(combo)) &&
      typeof fila.nombre === 'string' &&
      Number.isInteger(fila.cantidad) &&
      Number(fila.cantidad) >= 1 &&
      Number.isFinite(Number(fila.precio_unitario))
    );
  }
}
