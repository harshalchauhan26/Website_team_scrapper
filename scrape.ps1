$ErrorActionPreference = "Stop"
$all = @()
for ($p = 1; $p -le 6; $p++) {
    $url = "https://saakshakinni.com/wp-json/wc/store/v1/products?per_page=100&page=$p"
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
    $items = $r.Content | ConvertFrom-Json
    $all += $items
    Write-Output "page $p -> $($items.Count) products"
}

function StripHtml($s) {
    if (-not $s) { return "" }
    $t = $s -replace '<[^>]+>', ' '
    $t = [System.Net.WebUtility]::HtmlDecode($t)
    return ($t -replace '\s+', ' ').Trim()
}

$rows = foreach ($item in $all) {
    $images = ($item.images | ForEach-Object { $_.src }) -join ' | '
    $categories = ($item.categories | ForEach-Object { $_.name }) -join ' | '
    $attributes = ($item.attributes | ForEach-Object { "$($_.name): $(($_.terms | ForEach-Object {$_.name}) -join ', ')" }) -join ' | '
    [PSCustomObject]@{
        ID              = $item.id
        Name            = $item.name
        SKU             = $item.sku
        Permalink       = $item.permalink
        Type            = $item.type
        Price           = $item.prices.price / [math]::Pow(10,$item.prices.currency_minor_unit)
        RegularPrice    = $item.prices.regular_price / [math]::Pow(10,$item.prices.currency_minor_unit)
        SalePrice       = $item.prices.sale_price / [math]::Pow(10,$item.prices.currency_minor_unit)
        OnSale          = $item.on_sale
        Currency        = $item.prices.currency_code
        StockStatus     = $item.stock_status
        StockQuantity   = $item.stock_quantity
        Categories      = $categories
        Attributes      = $attributes
        ShortDescription= StripHtml $item.short_description
        Description     = StripHtml $item.description
        Images          = $images
        MainImage       = $item.images[0].src
        AverageRating   = $item.average_rating
        ReviewCount     = $item.review_count
    }
}

$rows | Export-Csv -Path "c:\Users\HARSHAL\OneDrive\Desktop\EXTRA_SCRAPER\saakshakinni_products.csv" -NoTypeInformation -Encoding UTF8
Write-Output "Total rows: $($rows.Count)"
