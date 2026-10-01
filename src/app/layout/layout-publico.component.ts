import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './header.component';
import { FooterComponent } from './footer.component';
import { AvisosComponent } from '../shared/components/avisos.component';

@Component({
  selector: 'app-layout-publico',
  imports: [RouterOutlet, HeaderComponent, FooterComponent, AvisosComponent],
  templateUrl: './layout-publico.component.html',
  styleUrl: './layout-publico.component.scss',
})
export class LayoutPublicoComponent {}
