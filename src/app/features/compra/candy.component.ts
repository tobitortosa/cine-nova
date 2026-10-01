import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CandyService } from '../../core/services/candy.service';
import { CarritoService } from '../../core/services/carrito.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { Categoria, Combo, ItemCarrito, Producto } from '../../core/models/modelos';
import { PrecioPipe } from '../../shared/pipes/precio.pipe';
import { CargandoComponent } from '../../shared/components/cargando.component';
import { VacioComponent } from '../../shared/components/vacio.component';

interface GrupoCandy {
  id: string;
  nombre: string;
  productos: Producto[];
}

const TOPE_CANTIDAD = 20;

@Component({
  selector: 'app-candy',
  imports: [RouterLink, PrecioPipe, CargandoComponent, VacioComponent],
  templateUrl: './candy.component.html',
  styleUrl: './candy.component.scss',
})
export class CandyComponent implements OnInit {
  private readonly candy = inject(CandyService);
  private readonly avisos = inject(NotificacionesService);
  readonly carrito = inject(CarritoService);

  readonly cargando = signal(true);
  readonly categorias = signal<Categoria[]>([]);
  readonly productos = signal<Producto[]>([]);
  readonly combos = signal<Combo[]>([]);
  readonly cantidades = signal<Record<string, number>>({});
  readonly grupoActivo = signal('');
  readonly detalleAbierto = signal(false);

  readonly grupos = computed<GrupoCandy[]>(() => {
    const lista = this.productos();
    const categorias = this.categorias();
    const armados: GrupoCandy[] = [];

    for (const categoria of categorias) {
      const dentro = lista.filter((producto) => producto.categoria_id === categoria.id);
      if (dentro.length > 0) {
        armados.push({
          id: 'categoria-' + categoria.id,
          nombre: categoria.nombre,
          productos: dentro,
        });
      }
    }

    const sueltos = lista.filter(
      (producto) =>
        producto.categoria_id === null ||
        !categorias.some((categoria) => categoria.id === producto.categoria_id),
    );

    if (sueltos.length > 0) {
      armados.push({ id: 'categoria-otros', nombre: 'Otros', productos: sueltos });
    }

    return armados;
  });

  readonly hayCatalogo = computed(() => this.combos().length > 0 || this.grupos().length > 0);

  async ngOnInit(): Promise<void> {
    try {
      const [categorias, productos, combos] = await Promise.all([
        this.candy.categorias(),
        this.candy.productos(true),
        this.candy.combos(true),
      ]);

      this.categorias.set(categorias);
      this.productos.set(productos);
      this.combos.set(combos);

      const primero = this.grupos()[0];
      if (primero) {
        this.grupoActivo.set(primero.id);
      }
    } catch (error) {
      this.avisos.error(
        error instanceof Error ? error.message : 'No se pudo cargar el candy bar',
      );
    } finally {
      this.cargando.set(false);
    }
  }

  claveProducto(producto: Producto): string {
    return 'producto-' + producto.id;
  }

  claveCombo(combo: Combo): string {
    return 'combo-' + combo.id;
  }

  cantidadDe(clave: string): number {
    return this.cantidades()[clave] ?? 1;
  }

  cambiarCantidad(clave: string, paso: number): void {
    const nueva = Math.min(TOPE_CANTIDAD, Math.max(1, this.cantidadDe(clave) + paso));
    this.cantidades.update((mapa) => ({ ...mapa, [clave]: nueva }));
  }

  agregarProducto(producto: Producto): void {
    const clave = this.claveProducto(producto);
    const cantidad = this.cantidadDe(clave);

    const item: ItemCarrito = {
      producto_id: producto.id,
      combo_id: null,
      nombre: producto.nombre,
      cantidad,
      precio_unitario: producto.precio,
      imagen_url: producto.imagen_url,
    };

    this.carrito.agregarProducto(item);
    this.reiniciar(clave);
    this.avisos.exito('Agregamos ' + cantidad + ' x ' + producto.nombre + ' a tu pedido');
  }

  agregarCombo(combo: Combo): void {
    const clave = this.claveCombo(combo);
    const cantidad = this.cantidadDe(clave);

    const item: ItemCarrito = {
      producto_id: null,
      combo_id: combo.id,
      nombre: combo.nombre,
      cantidad,
      precio_unitario: combo.precio,
      imagen_url: combo.imagen_url,
    };

    this.carrito.agregarProducto(item);
    this.reiniciar(clave);
    this.avisos.exito('Agregamos ' + cantidad + ' x ' + combo.nombre + ' a tu pedido');
  }

  ajustarDelCarrito(indice: number, paso: number): void {
    const actual = this.carrito.items()[indice];
    if (!actual) {
      return;
    }
    this.carrito.cambiarCantidad(indice, Math.min(TOPE_CANTIDAD, actual.cantidad + paso));
  }

  quitarDelCarrito(indice: number): void {
    const actual = this.carrito.items()[indice];
    if (!actual) {
      return;
    }
    this.carrito.quitarProducto(indice);
    this.avisos.info('Sacamos ' + actual.nombre + ' de tu pedido');
  }

  alternarDetalle(): void {
    this.detalleAbierto.update((abierto) => !abierto);
  }

  irACategoria(id: string): void {
    this.grupoActivo.set(id);
    const destino = document.getElementById(id);
    if (destino) {
      destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private reiniciar(clave: string): void {
    this.cantidades.update((mapa) => ({ ...mapa, [clave]: 1 }));
  }
}
