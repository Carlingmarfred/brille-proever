param(
    [int]$Port = 5185,
    [switch]$OpenBrowser
)

Add-Type -AssemblyName System.Web

$script:ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:AlgoliaHeaders = @{
    'X-Algolia-API-Key'        = 'e0a6dc96fb27769d00d343a53d82cfa7'
    'X-Algolia-Application-Id' = 'BIASZB3PRO'
}
$script:AlgoliaIndices = @{
    relevance = 'dk-synoptik-production-products'
    priceAsc  = 'dk-synoptik-production-products_price_asc'
    priceDesc = 'dk-synoptik-production-products_price_desc'
    newest    = 'dk-synoptik-production-products_instoredate_desc'
    sale      = 'dk-synoptik-production-products_discounted_desc'
}
$script:CatalogCache = @{}
$script:FullCatalogCache = @{}

function Get-ContentType {
    param([string]$Path)

    switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        '.html' { 'text/html; charset=utf-8' }
        '.css' { 'text/css; charset=utf-8' }
        '.js' { 'application/javascript; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.svg' { 'image/svg+xml' }
        '.png' { 'image/png' }
        '.jpg' { 'image/jpeg' }
        '.jpeg' { 'image/jpeg' }
        '.webp' { 'image/webp' }
        '.ico' { 'image/x-icon' }
        default { 'application/octet-stream' }
    }
}

function Write-BytesResponse {
    param(
        [System.Net.HttpListenerContext]$Context,
        [byte[]]$Bytes,
        [string]$ContentType,
        [int]$StatusCode = 200
    )

    $Context.Response.StatusCode = $StatusCode
    $Context.Response.ContentType = $ContentType
    $Context.Response.ContentLength64 = $Bytes.Length
    $Context.Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
    $Context.Response.OutputStream.Close()
}

function Write-TextResponse {
    param(
        [System.Net.HttpListenerContext]$Context,
        [string]$Text,
        [string]$ContentType,
        [int]$StatusCode = 200
    )

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    Write-BytesResponse -Context $Context -Bytes $bytes -ContentType $ContentType -StatusCode $StatusCode
}

function Write-JsonResponse {
    param(
        [System.Net.HttpListenerContext]$Context,
        [object]$Data,
        [int]$StatusCode = 200
    )

    $json = $Data | ConvertTo-Json -Depth 8 -Compress
    Write-TextResponse -Context $Context -Text $json -ContentType 'application/json; charset=utf-8' -StatusCode $StatusCode
}

function Get-FirstValue {
    param([object]$Value)

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [string] -or $Value.GetType().IsPrimitive) {
        return $Value
    }

    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [System.Collections.IDictionary])) {
        foreach ($item in $Value) {
            return $item
        }
    }

    return $Value
}

function Get-LocalizedValue {
    param([object]$Value)

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [string] -or $Value.GetType().IsPrimitive) {
        return [string]$Value
    }

    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [System.Collections.IDictionary])) {
        $first = Get-FirstValue -Value $Value
        return Get-LocalizedValue -Value $first
    }

    foreach ($candidate in @('da-DK', 'da', 'en-GB', 'en', 'label', 'key')) {
        $property = $Value.PSObject.Properties[$candidate]
        if ($property) {
            $resolved = Get-LocalizedValue -Value $property.Value
            if ($resolved) {
                return $resolved
            }
        }
    }

    $firstProperty = $Value.PSObject.Properties | Select-Object -First 1
    if ($firstProperty) {
        return Get-LocalizedValue -Value $firstProperty.Value
    }

    return [string]$Value
}

function Convert-AttributesToMap {
    param([object]$Attributes)

    $map = @{}
    foreach ($attribute in @($Attributes)) {
        if ($attribute -and $attribute.name) {
            $map[$attribute.name] = $attribute.value
        }
    }

    return $map
}

function Get-ImageDimensions {
    param([object]$Dimensions)

    if ($null -eq $Dimensions) {
        return @{
            width  = 0
            height = 0
        }
    }

    $width = 0
    $height = 0

    if ($Dimensions.PSObject.Properties['w']) {
        $width = [int]$Dimensions.w
    }

    if ($Dimensions.PSObject.Properties['h']) {
        $height = [int]$Dimensions.h
    }

    return @{
        width  = $width
        height = $height
    }
}

function Get-FrontImageData {
    param([object]$Media)

    foreach ($bucket in @($Media)) {
        foreach ($image in @($bucket.images)) {
            if ($image.label -eq 'Front') {
                $frontUrl = [string]$image.url
                $overlayUrl = if ($frontUrl -match '__shad__') {
                    $frontUrl -replace '__shad__', '__noshad__'
                }
                else {
                    $frontUrl
                }

                return @{
                    frontUrl    = $frontUrl
                    overlayUrl  = $overlayUrl
                    dimensions  = Get-ImageDimensions -Dimensions $image.dimensions
                }
            }
        }
    }

    return @{
        frontUrl    = $null
        overlayUrl  = $null
        dimensions  = @{
            width  = 0
            height = 0
        }
    }
}

function Build-AlgoliaParams {
    param(
        [string]$Query,
        [int]$Page,
        [int]$HitsPerPage = 18
    )

    $pairs = @(
        "query=$([System.Uri]::EscapeDataString($Query))",
        "hitsPerPage=$HitsPerPage",
        "page=$([Math]::Max($Page - 1, 0))",
        "facetFilters=$([System.Uri]::EscapeDataString('[[""filterableAttributes.productType:FRAMES""]]'))",
        "ruleContexts=$([System.Uri]::EscapeDataString('[""FRAMES""]'))",
        'clickAnalytics=true',
        'analytics=true'
    )

    return ($pairs -join '&')
}

function Invoke-AlgoliaCatalogSearch {
    param(
        [string]$Query,
        [int]$Page,
        [string]$Sort,
        [int]$HitsPerPage = 18
    )

    $resolvedSort = if ($script:AlgoliaIndices.ContainsKey($Sort)) { $Sort } else { 'relevance' }
    $cacheKey = "$resolvedSort|$Page|$HitsPerPage|$Query"

    if ($script:CatalogCache.ContainsKey($cacheKey)) {
        return $script:CatalogCache[$cacheKey]
    }

    $indexName = $script:AlgoliaIndices[$resolvedSort]
    $body = @{
        params = Build-AlgoliaParams -Query $Query -Page $Page -HitsPerPage $HitsPerPage
    } | ConvertTo-Json -Compress

    $response = Invoke-RestMethod `
        -Method Post `
        -Uri "https://BIASZB3PRO-dsn.algolia.net/1/indexes/$indexName/query" `
        -Headers $script:AlgoliaHeaders `
        -ContentType 'application/json' `
        -Body $body

    $script:CatalogCache[$cacheKey] = $response
    return $response
}

function Invoke-AlgoliaCatalogBrowse {
    param(
        [string]$Sort,
        [string]$Cursor,
        [int]$HitsPerPage = 1000
    )

    $resolvedSort = if ($script:AlgoliaIndices.ContainsKey($Sort)) { $Sort } else { 'relevance' }
    $indexName = $script:AlgoliaIndices[$resolvedSort]
    $cacheKey = "BROWSE|$resolvedSort|$HitsPerPage|$Cursor"

    if ($script:CatalogCache.ContainsKey($cacheKey)) {
        return $script:CatalogCache[$cacheKey]
    }

    $params = if ($Cursor) {
        "cursor=$([System.Uri]::EscapeDataString($Cursor))"
    }
    else {
        "hitsPerPage=$HitsPerPage&filters=$([System.Uri]::EscapeDataString('filterableAttributes.productType:FRAMES'))"
    }

    $body = @{
        params = $params
    } | ConvertTo-Json -Compress

    $response = Invoke-RestMethod `
        -Method Post `
        -Uri "https://BIASZB3PRO-dsn.algolia.net/1/indexes/$indexName/browse" `
        -Headers $script:AlgoliaHeaders `
        -ContentType 'application/json' `
        -Body $body

    $script:CatalogCache[$cacheKey] = $response
    return $response
}

function Get-FullCatalogItems {
    param([string]$Sort = 'relevance')

    $resolvedSort = if ($script:AlgoliaIndices.ContainsKey($Sort)) { $Sort } else { 'relevance' }
    $cacheKey = "ALL|$resolvedSort"

    if ($script:FullCatalogCache.ContainsKey($cacheKey)) {
        return $script:FullCatalogCache[$cacheKey]
    }

    $allHits = New-Object System.Collections.ArrayList
    $cursor = $null

    do {
        $browseResponse = Invoke-AlgoliaCatalogBrowse -Sort $resolvedSort -Cursor $cursor -HitsPerPage 1000
        foreach ($hit in @($browseResponse.hits)) {
            [void]$allHits.Add($hit)
        }
        $cursor = $browseResponse.cursor
    } while ($cursor)

    $mappedItems = @($allHits | ForEach-Object { Map-HitToProduct -Hit $_ })
    $payload = @{
        totalHits = $mappedItems.Count
        sort      = $resolvedSort
        items     = $mappedItems
    }

    $script:FullCatalogCache[$cacheKey] = $payload
    return $payload
}

function Get-ProductTitle {
    param(
        [object]$Hit,
        [hashtable]$Attributes
    )

    $brand = $Hit.masterVariant.brand
    if (-not $brand) {
        $brand = Get-FirstValue -Value $Hit.filterableAttributes.brand
    }

    $model = if ($Attributes.ContainsKey('brandModelCode')) {
        Get-LocalizedValue -Value $Attributes['brandModelCode']
    }
    elseif ($Attributes.ContainsKey('brandModel')) {
        Get-LocalizedValue -Value $Attributes['brandModel']
    }
    else {
        Get-LocalizedValue -Value $Hit.name
    }

    $colorCode = if ($Attributes.ContainsKey('brandModelColorCode')) {
        Get-LocalizedValue -Value $Attributes['brandModelColorCode']
    }
    else {
        $null
    }

    $pieces = @()
    foreach ($piece in @($brand, $model, $colorCode)) {
        if ($piece) {
            $pieces += $piece
        }
    }

    return ($pieces -join ' ').Trim()
}

function Map-HitToProduct {
    param([object]$Hit)

    $attributes = Convert-AttributesToMap -Attributes $Hit.masterVariant.attributes
    $imageData = Get-FrontImageData -Media $Hit.masterVariant.media

    $brand = $Hit.masterVariant.brand
    if (-not $brand) {
        $brand = Get-FirstValue -Value $Hit.filterableAttributes.brand
    }

    $shape = Get-FirstValue -Value $Hit.filterableAttributes.'frameShape_da-DK'
    if (-not $shape) {
        $shape = Get-LocalizedValue -Value $attributes['frameShape']
    }

    $color = Get-FirstValue -Value $Hit.filterableAttributes.'frameColor_da-DK'
    if (-not $color) {
        $color = Get-LocalizedValue -Value $attributes['frameColor']
    }

    $frameSize = Get-FirstValue -Value $Hit.filterableAttributes.'frameSize_da-DK'
    $segment = Get-FirstValue -Value $Hit.filterableAttributes.'segment_da-DK'
    $gender = Get-FirstValue -Value $Hit.filterableAttributes.'gender_da-DK'

    $slug = $null
    foreach ($candidate in @('da-DK', 'da', 'en-GB', 'en')) {
        $property = $Hit.slug.PSObject.Properties[$candidate]
        if ($property -and $property.Value) {
            $slug = [string]$property.Value
            break
        }
    }

    if (-not $slug) {
        $slug = [string]$Hit.masterVariant.sku
    }

    $priceNumber = [math]::Round(($Hit.sortingPrice / 100), 2)
    $productUrl = "https://www.synoptik.dk/briller/$slug/$($Hit.masterVariant.sku)"

    return @{
        objectId        = [string]$Hit.objectID
        sku             = [string]$Hit.masterVariant.sku
        slug            = $slug
        brand           = $brand
        title           = Get-ProductTitle -Hit $Hit -Attributes $attributes
        color           = $color
        shape           = $shape
        frameSize       = $frameSize
        segment         = $segment
        gender          = $gender
        price           = $priceNumber
        priceText       = ('{0:N0} kr.' -f $priceNumber).Replace(',', '.')
        productUrl      = $productUrl
        frontImageUrl   = $imageData.frontUrl
        overlayImageUrl = $imageData.overlayUrl
        image           = @{
            width  = $imageData.dimensions.width
            height = $imageData.dimensions.height
        }
        header          = Get-LocalizedValue -Value $attributes['header']
        description     = Get-LocalizedValue -Value $attributes['description']
        vtoEnabled      = [bool](Get-LocalizedValue -Value $attributes['vtoEnabled'])
        dimensions      = @{
            frameWidth   = [int](Get-LocalizedValue -Value $attributes['frameWidth'])
            lensWidth    = [int](Get-LocalizedValue -Value $attributes['lensWidth'])
            lensHeight   = [int](Get-LocalizedValue -Value $attributes['lensHeight'])
            bridgeWidth  = [int](Get-LocalizedValue -Value $attributes['bridgeWidth'])
            templeLength = [int](Get-LocalizedValue -Value $attributes['templeLength'])
        }
    }
}

function Handle-CatalogApi {
    param([System.Net.HttpListenerContext]$Context)

    $queryParams = [System.Web.HttpUtility]::ParseQueryString($Context.Request.Url.Query)
    $page = [int]($queryParams['page'])
    if ($page -lt 1) {
        $page = 1
    }

    $query = $queryParams['q']
    if ($null -eq $query) {
        $query = ''
    }

    $sort = $queryParams['sort']
    if (-not $sort) {
        $sort = 'relevance'
    }

    try {
        $result = Invoke-AlgoliaCatalogSearch -Query $query -Page $page -Sort $sort
        $items = @($result.hits | ForEach-Object { Map-HitToProduct -Hit $_ })

        Write-JsonResponse -Context $Context -Data @{
            page       = $page
            totalPages = [int]$result.nbPages
            totalHits  = [int]$result.nbHits
            sort       = $sort
            query      = $query
            items      = $items
        }
    }
    catch {
        Write-JsonResponse -Context $Context -StatusCode 502 -Data @{
            error   = 'catalog_fetch_failed'
            message = 'Kunne ikke hente Synoptik-kataloget lige nu.'
            detail  = $_.Exception.Message
        }
    }
}

function Handle-FullCatalogApi {
    param([System.Net.HttpListenerContext]$Context)

    $queryParams = [System.Web.HttpUtility]::ParseQueryString($Context.Request.Url.Query)
    $sort = $queryParams['sort']
    if (-not $sort) {
        $sort = 'relevance'
    }

    try {
        $result = Get-FullCatalogItems -Sort $sort
        Write-JsonResponse -Context $Context -Data @{
            totalHits = $result.totalHits
            sort      = $result.sort
            items     = $result.items
        }
    }
    catch {
        Write-JsonResponse -Context $Context -StatusCode 502 -Data @{
            error   = 'full_catalog_fetch_failed'
            message = 'Kunne ikke hente hele Synoptik-kataloget lige nu.'
            detail  = $_.Exception.Message
        }
    }
}

function Handle-StaticFile {
    param([System.Net.HttpListenerContext]$Context)

    $relativePath = $Context.Request.Url.AbsolutePath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($relativePath)) {
        $relativePath = 'index.html'
    }

    $fullPath = Join-Path $script:ProjectRoot $relativePath
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        Write-TextResponse -Context $Context -Text 'Ikke fundet' -ContentType 'text/plain; charset=utf-8' -StatusCode 404
        return
    }

    $bytes = [System.IO.File]::ReadAllBytes($fullPath)
    $contentType = Get-ContentType -Path $fullPath
    Write-BytesResponse -Context $Context -Bytes $bytes -ContentType $contentType
}

function Handle-Request {
    param([System.Net.HttpListenerContext]$Context)

    $path = $Context.Request.Url.AbsolutePath

    if ($path -eq '/api/catalog/all') {
        Handle-FullCatalogApi -Context $Context
        return
    }

    if ($path -eq '/api/catalog') {
        Handle-CatalogApi -Context $Context
        return
    }

    if ($path -eq '/api/health') {
        Write-JsonResponse -Context $Context -Data @{
            ok   = $true
            time = [DateTime]::UtcNow.ToString('o')
        }
        return
    }

    Handle-StaticFile -Context $Context
}

function Start-ListenerWithFallback {
    param([int]$PreferredPort)

    $candidatePorts = @($PreferredPort, 5190, 8787, 9010, 4174) | Select-Object -Unique
    $lastError = $null

    foreach ($candidatePort in $candidatePorts) {
        $candidateListener = New-Object System.Net.HttpListener
        $candidateListener.Prefixes.Add("http://localhost:$candidatePort/")

        try {
            $candidateListener.Start()
            return @{
                listener = $candidateListener
                port     = $candidatePort
            }
        }
        catch {
            $lastError = $_
            $candidateListener.Close()
        }
    }

    throw $lastError
}

$listenerInfo = Start-ListenerWithFallback -PreferredPort $Port
$listener = $listenerInfo.listener
$activePort = [int]$listenerInfo.port

Write-Host ""
if ($activePort -ne $Port) {
    Write-Host "Port $Port var ikke tilgaengelig, saa appen bruger http://localhost:$activePort" -ForegroundColor Yellow
}
else {
    Write-Host "Brille-proeveren koerer paa http://localhost:$activePort" -ForegroundColor Cyan
}
Write-Host "Stop serveren med Ctrl+C." -ForegroundColor DarkGray
Write-Host ""

if ($OpenBrowser) {
    Start-Process "http://localhost:$activePort/"
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        Handle-Request -Context $context
    }
}
finally {
    if ($listener.IsListening) {
        $listener.Stop()
    }

    $listener.Close()
}
