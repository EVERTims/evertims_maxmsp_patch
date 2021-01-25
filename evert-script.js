// inlets and outlets
inlets = 2;
outlets = 2;

// format
var tab = "       ";
var roundFactor = 2;

// init locals
var freqBandLimits = [212, 425, 850, 1700, 3300, 6000, 12800];
var freqBandCenters = [125, 250, 500, 1000, 2000, 4000, 8000, 16000];
var roomAreaWeighted = [0, 0, 0, 0, 0, 0, 0, 0];
var imageDefaultPosition = [0, 1, 0];

var materials = {};

var faces = {};
var isDefinedRoom = false;

var roomVolume = 0;
var roomArea = 0;
var roomAreaOld = 0;
var rt60 = [];

var images = {};
var defaultImages = {};

var srcPos = [0, 0, 0];
var rcvTransform = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];

var SOUND_SPEED = 343; // m/s
var MAX_NUM_IMAGES = 100;
var MAX_RT60_VALUE = 15; // in seconds

var NUM_DEFAULT_IMG_SRC = 0; // set to 0 to disable option
var defaultDelays = [];

var lateAnisotropicPos = [];

// debug (todelete)
// SOUND_SPEED = SOUND_SPEED / 5; // m/s
// NUM_DEFAULT_IMG_SRC = 30;

function anything()
{
	if( inlet == 0 )
	{ 
		processOscMsg(messagename, arguments); 
	}
	else
	{ 
		processCallback(messagename, arguments); 
	}
}

function processOscMsg(msgName, args)
{
	// split msg
	var msg = arrayfromargs(msgName, args);
	
	// extract header
	var headers = msg.shift();
	headers = headers.split("/");
	headers.shift(); // rm first element (empty)

	// process material definition message
	if( headers[0] == "material" )
	{	
		// material name: create material entry if needed
		if( headers[1] == "name" )
		{
			var name = msg[0];
			// post("mat name " + name + "\n");
			if( materials[ name ] == undefined ){ materials[ name ] = {}; }
		}
		
		// material frequency: assign 
		if( headers[2] == "frequencies" )
		{
			name = headers[1];
			// post("mat freq " + name + "\n");
			materials[ name ]["freq"] = msg;
		}

		// material absorption: assign
		if( headers[2] == "absorption" )
		{
			name = headers[1];
			// post("mat abs " + name + "\n");
			materials[ name ]["abs"] = msg;
		}
	}

	// room define start
	if( headers[2] == "definestart" ){ resetRoom(); }

	// room register faces
	if( headers[2] == "face" )
	{	
		// face id declaration 
		if( headers.length == 3 )
		{
			var faceId = msg[0];
			faces[faceId] = getNewFace();
		}
		// face material
		if( headers[4] == "material" )
		{
			var faceId = headers[3];
			faces[faceId].material = msg[0];
		}

		// face triangle
		if( headers[4] == "triangles" )
		{
			var faceId = headers[3];
			faces[faceId].triangle = msg;
		}
	}

	// room define over
	if( headers[2] == "defineover" ){ isDefinedRoom = true; }

	// get room volume
	if( headers[headers.length-1] == "volume" ){ roomVolume = msg[0]; }

	// get room area
	if( headers[headers.length-1] == "area" ){ roomAreaOld = msg[0]; }

	// remove path
	if( headers[headers.length-1] == "deleted" )
	{
		for (var iElmt = 0; iElmt < msg.length; iElmt++) 
		{
			var id = msg[iElmt];
			delete(images[id]);
		}
	}

	// image source: path length
	if( headers[headers.length-1] == "length" )
	{	

		// create image if need be
		var id = headers[headers.length-2];
		if( images[id] == undefined ){ images[id] = getNewImage(); }

		// save value
		images[id].length = msg[0];
	}

	// image reflectance values 
	if( headers[headers.length-1] == "reflectance" )
	{
		// create image if need be
		var id = headers[headers.length-2];
		if( images[id] == undefined ){ images[id] = getNewImage(); }

		// save value
		images[id].reflectance = arrayDbToA(msg);
	}

	// image specular values 
	if( headers[headers.length-1] == "specular" )
	{
		// create image if need be
		var id = headers[headers.length-2];
		if( images[id] == undefined ){ images[id] = getNewImage(); }

		// save value
		images[id].specular = msg;
	}

	// image scattered values 
	if( headers[headers.length-1] == "scattered" )
	{
		// create image if need be
		var id = headers[headers.length-2];
		if( images[id] == undefined ){ images[id] = getNewImage(); }

		// save value
		images[id].scattered = msg;
	}

	// image source: position
	if( headers[headers.length-2] == "image" && headers[headers.length-1] == "xyz" )
	{
		// create image if need be
		var id = headers[headers.length-3];
		if( images[id] == undefined ){ images[id] = getNewImage(); }

		images[id].xyz = msg;
	}
	
	// source position 
	if( headers[headers.length-3] == "source" && headers[headers.length-1] == "xyz" )
	{
		srcPos = msg;
	}

	// receiver transform 
	if( headers[headers.length-4] == "listener" && headers[headers.length-1] == "matrix" )
	{
		rcvTransform = msg;
	}	

	// post("msg: " + headers + " " + msg + "\n");
}

function processCallback(msgName, args)
{
	// split msg
	var msg = arrayfromargs(msgName, args);
	

	// extract header
	var headers = msg.shift();
	headers = headers.split("/");
	headers.shift(); // rm first element (empty)

	// process default image delays message
	if( headers[0] == "defaultDelays" )
	{
		// save to locals
		defaultDelays = msg;

		// somehow spat5.delgen will return at least 1 delay value, fix that
		if( NUM_DEFAULT_IMG_SRC == 0 ){ defaultDelays = []; }

		// update default image sources
		calculateDefaultImageSources();
		updateDefaultImageSources();
		resetUnusedImageSources();
	}

}


// bang produces general output update
function bang()
{
	// update static parameters (needed only once)
	updateStatic();

	// update room 
	updateRoom();

	// update image sources
	updateImageSources();


	// @todo: define fdn scatter delays
	var rt60_scatter = [0, 0, 0, 0, 0, 0, 0, 0]; 
	arrayFill(rt60_scatter, .2);

	// update fdn scatter delays
	outlet(0,"/fdn/scatter/decay/times", rt60_scatter);

	// update fdn late
	if( rt60.length > 0 ){ outlet(0,"/fdn/late/decay/times", rt60); }

	// fdn late: get mixing time and amplitude (for seamless stitching)
	var tMix = getMixingTime();
	outlet(0,"/fdn/late/roomoffset", tMix);
	var gMix = getMixingAmplitude();
	outlet(0,"/fdn/late/roomgain", gMix);

	// fdn late: spatial distribution
	// @todo: support multiple bands
	var freqId = 0;
	var xyz = lateAnisotropicPos[freqId];
	if( xyz != undefined ){ outlet(0,"/fdn/late/xyz", xyz); }

	// misc. debug print
	// printMaterials();
	// printRoom();
	// printFaces();
	// printImages(images, "Images");
	// printImages(defaultImages, "Default Images");
	// printScene();
}

// init spat5 parameters
function updateStatic()
{
	// num bands
	outlet(0,"/fdn/all/band/number", freqBandCenters.length);

	// frequency bands limits
	outlet(0,"/fdn/all/freq/limits", freqBandLimits);
	outlet(0,"/images/freq/centers", freqBandCenters);
}


function updateImageSources()
{

// update images
	var count = 1;
	for (var id in images)
	{
		// warn if max number of images reached 
		if( count > MAX_NUM_IMAGES){ post("WARNING: MAX NUMBER OF IMAGES REACHED \n"); }

		// update image delay
		var delay = images[id].length / SOUND_SPEED;
		outlet(0,"/image", count, "delay", delay);

		// update image position: specular
		var pos = getRelPos(images[id].xyz, rcvTransform);
		outlet(0,"/image", count, "xyz", "specular", pos);

		// update image position: scattered
		if( id != "direct" )
		{
			// get id of last hit face
			var faceId = id.split("-");
			faceId = faceId.pop();

			// get barycenter of last hit wall
			var xyz = getTriangleCenter(faces[faceId].triangle);
			pos = getRelPos(xyz, rcvTransform);

			// update image position: scattered (last encountered wall barycenter)
			outlet(0,"/image", count, "xyz", "scattered", pos);
		}

		// update image power 
		if( id == "direct" )
		{
			// special treatement for direct: all specular
			outlet(0,"/image", count, "gain", "specular", [1, 1, 1, 1, 1, 1, 1, 1]);
			outlet(0,"/image", count, "gain", "scattered", [0, 0, 0, 0, 0, 0, 0, 0]);
		}
		else
		{
			outlet(0,"/image", count, "gain", "specular", images[id].specular);
			outlet(0,"/image", count, "gain", "scattered", images[id].scattered);
			// outlet(0,"/image", count, "gain", "distance", images[id].reflectance);
		}
		outlet(0,"/image", count, "gain", "distance", 1/images[id].length);

		// increment counter
		count += 1;
	}

}


function resetRoom()
{
	// reset locals
	// beware, may produce discontinuities between room updates
	rt60 = [];
	images = {};
	faces = {};
	isDefinedRoom = false;

	// reset images
	for (var imageId = 1; imageId <= MAX_NUM_IMAGES; imageId++)
	{
		// update image power
		outlet(0,"/image", imageId, "gain", "distance", 0.0);
	}
}

function updateRoom()
{
	// discard if room not defined
	if( !isDefinedRoom ){ return; }
	
	updateRoomArea();
	updateRoomResponseTime();
	updateLateSpatialDistribution();
	
	// trigger default image source update mechanism
	queryDefaultDelays();
}

function updateRoomArea()
{
	// weighted areas per frequency band (@todo: support dynamic num bands)
	arrayFill(roomAreaWeighted, 0.0);
	
	roomArea = 0;

	// loop over room faces
	for (var faceId in faces) 
	{	

		// get face data
		var matName = faces[faceId].material;
		var triangle = faces[faceId].triangle;

		// discard if face not completely defined (should not be necessary thanks to isDefinedRoom check in updateRoom() method )
		// if( matName == undefined || triangle.length == 0 ){ continue; }

		// get face area
		area = getTriangleArea(triangle);

		// add area to room total area
		roomArea += area;

		// compute weighted area: loop over frequency bands
		for (var iBand = 0; iBand < freqBandCenters.length; iBand++) 
		{

			// debug
			if( materials[matName]["freq"] === undefined )
			{
				post(matName + " not in database " + "\n");
				printMaterials();
			}
			// get abs (avoid 0 absorption)
			var abs = getInterpAbs(materials[matName]["abs"], materials[matName]["freq"], freqBandCenters[iBand]);

			roomAreaWeighted[iBand] += abs * area;
			// post(faceId + " " + iBand + " " + abs + ": " + floatRound(roomAreaWeighted[iBand], roundFactor) + "\n");
		}
		// post(faceId + " " + floatRound(area, roundFactor) + " " + arrayRound(roomAreaWeighted, roundFactor) + "\n");

	}
}

function updateRoomResponseTime()
{
	// discard if volume not yet defined
	if( roomVolume == 0 || roomArea == 0 ) { return; }

	// loop over freq bands
	for (var iFreq = 0; iFreq < roomAreaWeighted.length; iFreq++) 
	{
		// default if any area not yet defined
		if( roomAreaWeighted[iFreq] == 0.0 )
		{ 
			post("zeroed out room area weighted (null absorption?), clipping rt60 \n")
			rt60[iFreq] = MAX_RT60_VALUE;
			continue; 
		}

		// get frequency specific RT60 from Sabine formula
	    // rt60[iFreq] = 0.161 * roomVolume / roomAreaWeighted[iFreq];

	    // get frequency specific RT60 from Eyring formula
	    var alpha = roomAreaWeighted[iFreq] / roomArea;
	    // post("alpha " + iFreq + " " + alpha + "\n");
	    var A = roomArea * (-2.3 * Math.log(1 - alpha)/Math.log(10))
		rt60[iFreq] = 0.161 * roomVolume / A;

	    // avoid infinite reverb (to discuss if we allow such behaviors)
	    rt60[iFreq] = Math.min( rt60[iFreq], MAX_RT60_VALUE );
	}

	// post("freq: " + freqBandCenters + "\n");
	// post("rt60: " + arrayRound(rt60, roundFactor) + "\n");
	
}

function updateLateSpatialDistribution() 
{
	// discard if too few images 
	if(Object.keys(images).length == 0){ return; }
	
	// get summed image source powers (to later calculate relative contributions)
	summedReflectance = [0, 0, 0, 0, 0, 0, 0, 0];
	for(var id in images)
	{
		summedReflectance = arrayAdd(summedReflectance, images[id].reflectance);
	}

	// post("summed reflectances " + arrayRound(summedReflectance, roundFactor) + "\n");

	// loop over freq bands: init
	lateAnisotropicPos = []; // freq band x position
	
	// loop over freq bands
	for (var iFreq = 0; iFreq < freqBandCenters.length; iFreq++)
	{
		// per freq predominant position
		var meanPos = [0, 0, 0];

		// loop over images
		for(var id in images)
		{
			var g = images[id].reflectance[iFreq] / summedReflectance[iFreq];
			meanPos = arrayAdd(meanPos, arrayMult(images[id].xyz, g));
			// post("image " + id + " g " + floatRound(g, roundFactor) + " pos " + arrayRound(meanPos, roundFactor) + "\n");
		}

		meanPos = getRelPos(meanPos, rcvTransform);

		// save to locals
		lateAnisotropicPos.push(meanPos);
	}
}


function queryDefaultDelays()
{
	// get min delay (first image source)
	var minDelay = Infinity;
	for( var id in images )
	{ 
		minDelay = Math.min( minDelay, images[id].length / SOUND_SPEED); 
	}
	// incr min delay to avoid overlap with existing image sources
	minDelay += minDelay + 0.0005; // arbitrary

	// get max delay (mixing time)
	var maxDelay = getMixingTime();

	// // @debug (values used in spat5.early and cluster)
	// minDelay = 0.020;
	// maxDelay = 0.080;

	// discard if anything went wrong
	if( minDelay == Infinity || maxDelay == 0 ){ return; }

	// update image power
	outlet(1,"queryDefaultDelays", NUM_DEFAULT_IMG_SRC, minDelay, maxDelay);
}


function calculateDefaultImageSources()
{
	
	// reset locals
	defaultImages = {};

	// get max image sources delay
	var maxDelay = getMaxDelay(images);

	// loop over default image sources
	for (var iDelay = 0; iDelay < defaultDelays.length; iDelay++)
	{
		// discard if reached default image sources that arrive before real ones (no longer required then)
		if( defaultDelays[iDelay] <= maxDelay ){ break; }
		
		// get new image source
		var image = getNewImage();

		// calculate image source path length
		image.length = defaultDelays[iDelay] * SOUND_SPEED;

		// // calculate image source power v1
		// for (var iFreq = 0; iFreq < freqBandCenters.length; iFreq++) 
		// {
		// 	// here specular is abused, storing both distance gain and specular info
		// 	var tmp = defaultDelays[iDelay] * (-60 / rt60[iFreq]);
		// 	image.specular[iFreq] = floatDbToA( tmp );
		// }

		// calculate image source power v2
		// here specular is abused, storing both distance gain and specular info
		image.specular = arrayMult( [1, 1, 1, 1, 1, 1, 1, 1], 1/(Math.pow(image.length, 0.6)) );
		image.specular = arrayClip(image.specular, 0.0, 1.0);

		// arbitrary spread of image position based on delay (the longer the further)
		// @todo: spread in the spherical domain
		var pos = srcPos;
		var posOffset = [2*(Math.random()-.5), 2*(Math.random()-.5), 2*(Math.random()-.5)];
		var posOffset = arrayMult( posOffset, 100*defaultDelays[iDelay] );
		// post("delay " + floatRound(defaultDelays[iDelay], roundFactor) + " posOffset " + arrayRound(posOffset, roundFactor) + "\n");
		image.xyz = arrayAdd(pos, posOffset);

		// save to locals
		defaultImages[iDelay] = image;
	}

}

function updateDefaultImageSources()
{
	// get initial non occupied image source poly~ id
	var count = Object.keys(images).length + 1; // init id is next non-occupied poly~ (+ poly~ numbering starts at 1)

	// loop over default image sources
	for (var id in defaultImages)
	{
		// break loop if max number of available images (poly~) reached 
		if( count > MAX_NUM_IMAGES )
		{ 
			post("NOTE: MAX NUMBER OF IMAGES REACHED (placeholders)\n"); 
			break;
		}

		// update image position
		var pos = getRelPos(defaultImages[id].xyz, rcvTransform);
		outlet(0,"/image", count, "xyz", "specular", pos);
		outlet(0,"/image", count, "xyz", "scattered", pos);

		// update image delay
		var delay = defaultImages[id].length / SOUND_SPEED;
		outlet(0,"/image", count, "delay", delay);

		// update image power
		// here specular is abused, storing both distance gain and specular info
		outlet(0,"/image", count, "gain", "specular", defaultImages[id].specular);
		outlet(0,"/image", count, "gain", "distance", 1.0);

		// increment counter
		count += 1;
	}

}

function resetUnusedImageSources()
{
	// get unused image source start id
	var startId = Object.keys(images).length + Object.keys(defaultImages).length + 1;	

	// reset images
	for (var imageId = startId; imageId <= MAX_NUM_IMAGES; imageId++)
	{
		// update image power
		outlet(0,"/image", imageId, "gain", "distance", 0.0);
	}
}


/**
@todo: 
- clarify definitions of reflectance (eventually removed) compared to distance gain + (specular, scattered)

@done?
- discard reflectance, use path length + specular / scattered to compute image source power
- even then, double check values as their is something fishy (0.2*0.2 != 0.008)
*/

function getNewImage()
{
	return {
		"length": undefined, 
		"xyz": imageDefaultPosition,
		"reflectance": [0, 0, 0, 0, 0, 0, 0, 0],
		"specular": [0, 0, 0, 0, 0, 0, 0, 0],
		"scattered": [0, 0, 0, 0, 0, 0, 0, 0]
	};
}

function getNewFace()
{
	return {
		"triangle": [], 
		"material": undefined
	};
}

function getMeanFreePath()
{
	// default if not enough info on room yet
	if( roomVolume == 0 || roomArea == 0 ){ return 0; }

	return 4 * roomVolume / roomArea;
}

function getMaxMixingTime()
{
	// default if not enough info on room yet
	if( roomVolume == 0 || roomArea == 0 ){ return 0; }

	return Math.sqrt(roomVolume) / 1000;
	// return 3*(4*roomVolume/roomArea)/SOUND_SPEED; // other model
}

function getMixingTime()
{
	// default if not enough info on room yet
	if( roomVolume == 0 || roomArea == 0 ){ return 0; }

	// default if no source-images yet
	if( Object.keys(images).length == 0 ){ return 0; } 

	// get max mixing time
	var tMixMax = getMaxMixingTime();

	// get list of image sources ordered by time of arrival
	var sortedImageIds = getSortedImageIds();

	// compute max acceptable gap between image sources, to avoid stitching FDN 
	// after a gap in image sources (i.e. to a lonely cluster of IS) if said gap
	// is not explained by room geometry but rather a lack of IS order
	var meanFreePath = getMeanFreePath();
	var maxAcceptableGapDuration = meanFreePath / SOUND_SPEED;

	// loop over images, check it passes test success (not lonely image)
	// and use it to define mixing time if not reached tMixMax yet
	var toa, toaNext, gapDuration;	
	for (var imageId = 0; imageId < sortedImageIds.length; imageId++)
	{
		// get image source time of arrival 
		toa = images[sortedImageIds[imageId]].length / SOUND_SPEED;

		// stop searching if toa above max mixing time
		if( toa > tMixMax ){ return tMixMax; }

		// stop searching if image source is the last one
		if( imageId == sortedImageIds.length-1 ){ return toa; }

		// calculate gap between current and next image
		toaNext = images[sortedImageIds[imageId+1]].length / SOUND_SPEED;
		gapDuration = toaNext - toa;

		// if gap duration too long, discard remaining cluster(s)
		if( gapDuration > maxAcceptableGapDuration ){ return toa; }
	}

}

// get max tail mixing gain (in dB)
function getMaxMixingAmplitude()
{
	// get locals
	var meanFreePath = getMeanFreePath();
	var tMixMax = getMaxMixingTime();

	// compute max acceptable gain (h)
	// @todo: think: is it 10*log10 or 20*log10?
	var gMixMax = 10*log10(1/(meanFreePath)) + tMixMax * (-60 / arrayMean(rt60));
	// post("max tail gain: " + floatRound(gMixMax, 1) + "dB \n")

	return gMixMax;
}

// get fdn mixing amplitude in dB
function getMixingAmplitude()
{

	// default if not enough info on room yet
	if( roomVolume == 0 || roomArea == 0 ){ return -60; }

	// define searching time window (around mixing time)
	var winDuration = 0.02; // in sec

	// get list of image source in time window
	var tMix = getMixingTime();
	var toa, g, imageAmplitudes = [];
	for (var id in images)
	{
		// get image time of arrival 
		toa = images[id].length / SOUND_SPEED;

		// is in time window?
		if( toa > (tMix - winDuration / 2) && toa < (tMix + winDuration / 2) )
		{
			// init locals
			g = 1.0;
			
			// specular/scattering for all but direct path
			if( id != "direct" )
			{
				// @todo: think on this mean over specular and scattering...
				g = ( arrayMean( images[id].specular ) + arrayMean( images[id].scattered ) ) / 2;
			}
			
			// distance attenuation
			g = (1/images[id].length) * g;
			
			// convert to dB
			g = floatAToDb(g);
			
			// store
			imageAmplitudes.push( g );
		}
	}

	// get max mixing amplitude
	var gMixMax = getMaxMixingAmplitude();

	// default value if empty 
	if( imageAmplitudes.length == 0 ){ return gMixMax; }

	// get average
	// var meanAmpl = arrayMean(imageAmplitudes);
	var meanAmpl = arrayMedian(imageAmplitudes);
	
	// add gain so that FDN first samples are somewhat close to 1
	// @todo: characterize init FDN gain, REMOVE THIS LINE
	meanAmpl += 14;

	// // compensate for mixing time already taking toll on fdn gain
	// // @todo: make it freq band specific (then FDN init gain would have to be as well)
	// meanAmpl = meanAmpl + ( 60 / arrayMean(rt60) ) * tMix;
	//
	// // no "toll" taken on fdn gain when delay definition based on "roomOffset" parameter
	// // lines above only useful if gain incorporated to fdn delays directly
	
	// return clipped value
	return Math.min(meanAmpl, gMixMax);
}


// return an array of imgs id sorted based on path length (i.e. time of arrival)
function getSortedImageIds()
{
	// Create items array
	var idPathPairs = Object.keys(images).map(function(key) {
		return [key, images[key].length];
	});

	// Sort the array based on the second element
	idPathPairs.sort(function(first, second) {
		return first[1]-second[1];
	});

	// keep only img ids
	var ids = []
	idPathPairs.forEach(function(item, index, array) {
		ids.push(item[0]);
	})
	
	return ids;
}

function getMaxDelay(imgs)
{
	var maxDelay = 0;
	for( var id in images )
	{ 
		maxDelay = Math.max( maxDelay, imgs[id].length / SOUND_SPEED); 
	}
	return maxDelay;
}



function post2(elmt){ post(tab + elmt); }

function printMaterials()
{
	post("Materials: \n");

	for(var key in materials)
	{
		post2(key + "\n");
		post2("  freq " + materials[key]["freq"] + "\n");
		post2("  abs " + arrayRound(materials[key]["abs"],roundFactor) + "\n");
	}
}

function printRoom()
{
	post("Room: \n");

	post2("area old " + floatRound(roomAreaOld, roundFactor) + "\n");
	post2("area new " + floatRound(roomArea, roundFactor) + "\n");
	post2("area weighted " + arrayRound(roomAreaWeighted, roundFactor) + "\n");
	post2("volume " + floatRound(roomVolume, roundFactor) + "\n");
	post2("num faces " + Object.keys(faces).length + "\n");
	post2("rt60 " + arrayRound(rt60, roundFactor) + "\n");
}

function printFaces()
{
	post("Faces: \n");

	// loop over room faces
	for(var faceId in faces)
	{
		post2(faceId + " " + faces[faceId].material + " " + arrayRound(faces[faceId].triangle, roundFactor) + "\n");
	}
}

function printImages(imgDict, header)
{
	post(header + ":\n");

	post2("number " + Object.keys(imgDict).length + "\n");

	// // long version 
	// for (var id in imgDict)
	// {
	// 	post2(id + " length: " + floatRound(imgDict[id].length, roundFactor) + ", xyz " + arrayRound(imgDict[id].xyz, roundFactor) + "\n");
	// 	post2(tab + "reflectance " + arrayRound(imgDict[id].reflectance, roundFactor) + "\n");
	// 	post2(tab + "specular " + arrayRound(imgDict[id].specular, roundFactor) + "\n");
	// 	post2(tab + "scattered " + arrayRound(imgDict[id].scattered, roundFactor) + "\n");
	// }

	// short version 
	var bandId = 0;
	for (var id in imgDict)
	{
		post2(id + " length: " + floatRound(imgDict[id].length, roundFactor) + ", xyz " + arrayRound(imgDict[id].xyz, 2) + ", refl " + floatRound(imgDict[id].reflectance[bandId], 2) + ", spec " + floatRound(imgDict[id].specular[bandId], 2) + ", scat " + floatRound(imgDict[id].scattered[bandId], 2) + "\n");
	}

}

function printScene()
{
	post("Scene: \n");

	post2("listener transform " + arrayRound(rcvTransform, roundFactor) + "\n");
	post2("source xyz " + arrayRound(srcPos, roundFactor) + "\n");
}



// @todo: uniformize math API so that every function behaves the same (e.g. arrayFill and arraySum both returning an array while not modifying the original)

// doesn't support below min / above max frequencies
// @todo: double check method
function getInterpAbs(arrayAbs, arrayFreq, freq)
{
	// get nearest neighbor
	var id = 0;

	for (var i = 0; i < (arrayFreq.length-1); i++) 
	{
		if( freq > arrayFreq[i] && freq <= arrayFreq[i+1] )
		{
			id = i;
			continue;
		}
	}

	// linear interpolation 
	g = (freq - arrayFreq[id]) / (arrayFreq[id+1] - arrayFreq[id]);
	var abs = arrayAbs[id] * (1-g) + arrayAbs[id+1] * g;

	return abs;
}

// from https://en.wikipedia.org/wiki/Heron%27s_formula
function getTriangleArea(triangle)
{
	var a = triangle.slice(0, 3);
	var b = triangle.slice(3, 6);
	var c = triangle.slice(6, 9);

	var ab = distBetween(a, b);
	var ac = distBetween(a, c);
	var bc = distBetween(b, c);

	var s = (ab + ac + bc) / 2;

	var area = Math.sqrt( s*(s-ab)*(s-ac)*(s-bc) );
	return area;
}

// centroid really
function getTriangleCenter(triangle)
{
	var a = triangle.slice(0, 3);
	var b = triangle.slice(3, 6);
	var c = triangle.slice(6, 9);

	var pos = arrayAdd(arrayAdd(a, b), c);
	pos = arrayMult(pos, 1/3);

	return pos;
}

function distBetween(x, y)
{
	return Math.sqrt( Math.pow(y[0]-x[0], 2) + Math.pow(y[1]-x[1], 2) + Math.pow(y[2]-x[2], 2) );
}

function arrayRound(a, r)
{
	// discard if undefined array
	if( a == undefined ){ return a;}

	var a2 = [];
	for (var i = 0; i < a.length; i++){ a2[i] = a[i].toFixed(r); }
	return a2;
}

function arrayMean(a) 
{
	return arraySum(a) / a.length;
}

function arrayMedian(a) 
{
	a.sort(function(a, b){return a-b})
	var val, id;
	if( (a.length % 2) === 0 )
	{
		id = a.length / 2;
		val =  (a[id-1] + a[id] ) / 2.0;
	}
	else
	{
		id = Math.floor( a.length / 2 );
		val = a[id];
	}

	// post("array: " + arrayRound(a, roundFactor) + "\n");
	// post("length: " + a.length + ", id median: " + id + ", val " + val + "\n");

	return val;
}

function arraySum(a)
{
	var sum = 0;
	for (var i = 0; i < a.length; i++)
	{ 
		if( !isNaN(a[i]) ){ sum += a[i]; }
	}
	return sum;	
}

function arrayDiff(a1, a2)
{
	var b = [];
	for (var i = 0; i < a1.length; i++){ b[i] = a1[i] - a2[i]; }
	return b;
}

function arrayAdd(a1, a2)
{
	var b = [];
	for (var i = 0; i < a1.length; i++){ b[i] = a1[i] + a2[i]; }
	return b;
}

function arrayMult(a, value)
{
	var b = [];
	for (var i = 0; i < a.length; i++){ b[i] = value*a[i]; }
	return b;
}

function arrayFill(a, value)
{
	for (var i = 0; i < a.length; i++){ a[i] = value; }
	return a;
}

function arrayDbToA(a)
{
	var b = [];
	for (var i = 0; i < a.length; i++){ b[i] = floatDbToA(a[i]); }
	return b;
}

function arrayClip(a, vMin, vMax)
{
	var b = [];
	for (var i = 0; i < a.length; i++){ b.push( Math.min( Math.max(a[i], vMin), vMax ) ); }
	return b;
}

// @todo: check this 20, isn't it 10? 
function floatDbToA(x)
{
	return Math.pow(10, x/20);
}

// @todo: check this 20, isn't it 10? 
function floatAToDb(x)
{
	return 20*log10(x);
}

function floatRound(x, r)
{
	return x.toFixed(r);
}

// see e.g. https://stackoverflow.com/questions/2624422/efficient-4x4-matrix-inverse-affine-transform
function getRelPos(posA, transform)
{
	var posB = transform.slice(12,15);
	var rotB = transform.slice(0,3).concat(transform.slice(4,7)).concat(transform.slice(8,11));
	
	rotB = transposeMat33(rotB);
	var pos = arrayDiff(posA, posB);
	
	pos = multMat33Vect3(rotB, pos);

	return pos;
}

function transposeMat33(mat)
{
	return [mat[0], mat[3], mat[6], mat[1], mat[4], mat[7], mat[2], mat[5], mat[8]];
}

function multMat33Vect3(mat, vec)
{
	return [mat[0] * vec[0] + mat[3] * vec[1] + mat[6] * vec[2], mat[1] * vec[0] + mat[4] * vec[1] + mat[7] * vec[2], mat[2] * vec[0] + mat[5] * vec[1] + mat[8] * vec[2] ];
}

function log10(x)
{
	return Math.log(x) / Math.log(10);
}


/** to do

- make sure all variables are set up upon last message (e.g. last received path
smaller than others will still )

- remove placeholders image-sources, doesn't really work (FDN does the job as long as changing it's starting point live is not an issue)

*/

/** to ask

(no) - need per-band "equivalent area" (pre-multiplied by absorption coefs) for computation of 
sabine room response time

- need adjustable overall delay for FDN (different from current /delays option)

- what does "relative decay time" (tr low med high) compared to tr0 means?

- open API: add num FDN internal channel 

- per freq band init power (/reverb/gain)

*/

