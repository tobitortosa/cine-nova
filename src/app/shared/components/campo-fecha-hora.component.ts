import { Component, computed, effect, input, model, signal, untracked, viewChild } from '@angular/core';
import { AtajoFecha, CampoFechaComponent } from './campo-fecha.component';
import { CampoHoraComponent } from './campo-hora.component';
import {
  HORARIOS_SUGERIDOS,
  capitalizar,
  describirFecha,
  esHoraValida,
  fechaCorta,
  normalizarClave,
} from '../utils/fechas';

const FORMATO_MOMENTO = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

@Component({
  selector: 'app-campo-fecha-hora',
  imports: [CampoFechaComponent, CampoHoraComponent],
  templateUrl: './campo-fecha-hora.component.html',
  styleUrl: './campo-fecha-hora.component.scss',
})
export class CampoFechaHoraComponent {
  private static contador = 0;

  readonly valor = model<string>('');
  readonly minimo = input<string>('');
  readonly etiqueta = input<string>('Fecha y hora');

  readonly prefijo = `campo-fecha-hora-${++CampoFechaHoraComponent.contador}`;

  readonly atajos: readonly AtajoFecha[] = [
    { texto: 'Hoy', dias: 0 },
    { texto: 'Mañana', dias: 1 },
    { texto: '+7 días', dias: 7 },
  ];
  readonly sugeridos = HORARIOS_SUGERIDOS;

  readonly fecha = signal('');
  readonly hora = signal('');

  private readonly campoHora = viewChild(CampoHoraComponent);
  private ultimoEmitido = '';

  readonly momentoMinimo = computed(() => {
    const partes = FORMATO_MOMENTO.exec((this.minimo() ?? '').trim());
    if (!partes || !normalizarClave(partes[1]) || !esHoraValida(partes[2])) return '';
    return `${partes[1]}T${partes[2]}`;
  });

  readonly fechaMinima = computed(() => this.momentoMinimo().slice(0, 10));

  readonly horaMinima = computed(() => {
    const minimo = this.momentoMinimo();
    return minimo && this.fecha() === minimo.slice(0, 10) ? minimo.slice(11, 16) : '';
  });

  readonly momento = computed(() =>
    this.fecha() && this.hora() ? `${this.fecha()}T${this.hora()}` : '',
  );

  readonly antesDelMinimo = computed(() => {
    const momento = this.momento();
    const minimo = this.momentoMinimo();
    return momento !== '' && minimo !== '' && momento < minimo;
  });

  readonly resumen = computed(() => {
    const fecha = this.fecha();
    const hora = this.hora();

    if (this.antesDelMinimo()) {
      const minimo = this.momentoMinimo();
      return `Tiene que ser desde el ${fechaCorta(minimo.slice(0, 10))} a las ${minimo.slice(11, 16)} h.`;
    }
    if (fecha && hora) return `${capitalizar(describirFecha(fecha))} · ${hora} h`;
    if (fecha) return `${capitalizar(describirFecha(fecha))} · falta la hora`;
    if (hora) return `Falta el día · ${hora} h`;
    return 'Escribí el día y la hora';
  });

  constructor() {
    effect(() => {
      const entrante = this.valor();
      untracked(() => {
        if (entrante !== this.ultimoEmitido) this.leer(entrante);
      });
    });
  }

  cambiarFecha(valor: string): void {
    this.fecha.set(valor);
    this.emitir();
  }

  cambiarHora(valor: string): void {
    this.hora.set(valor);
    this.emitir();
  }

  pasarALaHora(): void {
    this.campoHora()?.enfocar();
  }

  private emitir(): void {
    const compuesto = this.antesDelMinimo() ? '' : this.momento();
    if (compuesto === this.ultimoEmitido) return;
    this.ultimoEmitido = compuesto;
    this.valor.set(compuesto);
  }

  private leer(texto: string): void {
    const partes = FORMATO_MOMENTO.exec((texto ?? '').trim());
    this.ultimoEmitido = texto;
    this.fecha.set(partes ? normalizarClave(partes[1]) : '');
    this.hora.set(partes && esHoraValida(partes[2]) ? partes[2] : '');
  }
}
