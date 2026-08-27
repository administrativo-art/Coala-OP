import { CompanyLookupService } from './company-lookup-service';

export class CompanyRefreshService {
  constructor(private readonly lookupService: CompanyLookupService) {}

  async refresh(cnpj: string, userId: string) {
    return this.lookupService.lookup(cnpj, userId, {
      forceExternal: true,
      skipInternal: true,
    });
  }
}
